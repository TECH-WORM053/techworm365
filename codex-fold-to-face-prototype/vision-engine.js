import { FaceLandmarker, FilesetResolver, HandLandmarker } from "./vendor/mediapipe/vision_bundle.mjs";

const wasm = new URL("./vendor/mediapipe/wasm", import.meta.url).href.replace(/\/$/, "");
const model = new URL("./models/face_landmarker.task", import.meta.url).href;
const handModel = new URL("./models/hand_landmarker.task", import.meta.url).href;
const lerp = (a,b,t)=>a+(b-a)*t;

export class FaceTracker {
  constructor(video){
    this.video=video; this.task=null; this.handTask=null; this.lastTime=-1; this.lastSeen=0;this.lastHandRun=0;this.lastHandSeen=0;
    this.signal={visible:false,x:.5,y:.46,width:.3,eyeWidth:.22,tilt:0,yaw:0,pitch:0,matrix:null,videoWidth:0,videoHeight:0,facePoints:[],faceAnchor:null,handVisible:false,handOpen:1,handX:.5,handY:.5,hands:[]};
  }
  async init(){
    const files=await FilesetResolver.forVisionTasks(wasm);
    const options={baseOptions:{modelAssetPath:model,delegate:"GPU"},runningMode:"VIDEO",numFaces:1,minFaceDetectionConfidence:.5,minFacePresenceConfidence:.5,minTrackingConfidence:.5,outputFacialTransformationMatrixes:true};
    try{this.task=await FaceLandmarker.createFromOptions(files,options)}catch{options.baseOptions.delegate="CPU";this.task=await FaceLandmarker.createFromOptions(files,options)}
    const handOptions={baseOptions:{modelAssetPath:handModel,delegate:"GPU"},runningMode:"VIDEO",numHands:2,minHandDetectionConfidence:.45,minHandPresenceConfidence:.45,minTrackingConfidence:.45};
    try{this.handTask=await HandLandmarker.createFromOptions(files,handOptions)}catch{handOptions.baseOptions.delegate="CPU";this.handTask=await HandLandmarker.createFromOptions(files,handOptions)}
  }
  update(now){
    if(!this.task||this.video.readyState<2||this.video.currentTime===this.lastTime)return this.lose(now);
    this.lastTime=this.video.currentTime;
    const result=this.task.detectForVideo(this.video,now),lm=result.faceLandmarks?.[0];
    this.updateHands(now);
    if(!lm)return this.lose(now);
    const left=lm[234],right=lm[454],eyeL=lm[33],eyeR=lm[263],nose=lm[1],noseBridge=lm[168],chin=lm[152],forehead=lm[10];
    const contourWidth=Math.abs(right.x-left.x),eyeWidth=Math.max(.001,Math.abs(eyeR.x-eyeL.x));
    const eyeMidX=(eyeL.x+eyeR.x)/2,eyeY=(eyeL.y+eyeR.y)/2;
    const faceHeight=Math.max(.001,chin.y-forehead.y);
    const depthYaw=-Math.atan2(eyeR.z-eyeL.z,eyeR.x-eyeL.x);
    const noseYaw=-(nose.x-eyeMidX)/eyeWidth*1.65;
    const yaw=(Math.abs(depthYaw)>.035?depthYaw:noseYaw)*1.42;
    const anchorX=eyeMidX*.3+noseBridge.x*.7;
    const anchorY=eyeY*.55+noseBridge.y*.45;
    const target={x:1-anchorX,y:anchorY,width:contourWidth,eyeWidth,tilt:Math.atan2(eyeL.y-eyeR.y,eyeWidth),yaw,pitch:((nose.y-eyeY)/faceHeight-.23)*2.4};
    this.signal.x=lerp(this.signal.x,target.x,.32); this.signal.y=lerp(this.signal.y,target.y,.32);
    this.signal.width=lerp(this.signal.width,target.width,.28);this.signal.eyeWidth=lerp(this.signal.eyeWidth,target.eyeWidth,.3);this.signal.tilt=lerp(this.signal.tilt,target.tilt,.3); this.signal.yaw=lerp(this.signal.yaw,target.yaw,.3);this.signal.pitch=lerp(this.signal.pitch,target.pitch,.22);
    this.signal.matrix=result.facialTransformationMatrixes?.[0]?.data?Array.from(result.facialTransformationMatrixes[0].data):null;
    this.signal.videoWidth=this.video.videoWidth;this.signal.videoHeight=this.video.videoHeight;
    this.signal.facePoints=lm.map(point=>({x:1-point.x,y:point.y,z:point.z}));
    this.signal.faceAnchor={x:1-noseBridge.x,y:noseBridge.y,leftEye:{x:1-eyeL.x,y:eyeL.y},rightEye:{x:1-eyeR.x,y:eyeR.y}};
    this.lastSeen=now; this.signal.visible=true; return this.signal;
  }
  lose(now){if(now-this.lastSeen>700)this.signal.visible=false;return this.signal}
  updateHands(now){
    if(!this.handTask||now-this.lastHandRun<70)return;
    this.lastHandRun=now;
    const hands=this.handTask.detectForVideo(this.video,now).landmarks||[];
    if(!hands.length){if(now-this.lastHandSeen>300){this.signal.handVisible=false;this.signal.hands=[]}return}
    let best=null;
    this.signal.hands=hands.map(lm=>lm.map(point=>({x:1-point.x,y:point.y,z:point.z})));
    for(const lm of hands){
      const thumb=lm[4],index=lm[8],wrist=lm[0],middle=lm[9];
      const palm=Math.max(.001,Math.hypot(middle.x-wrist.x,middle.y-wrist.y));
      const ratio=Math.hypot(index.x-thumb.x,index.y-thumb.y)/palm;
      const candidate={open:Math.max(0,Math.min(1,(ratio-.18)/.72)),x:1-(thumb.x+index.x)/2,y:(thumb.y+index.y)/2};
      if(!best||candidate.open<best.open)best=candidate;
    }
    this.signal.handOpen=lerp(this.signal.handOpen,best.open,.38);this.signal.handX=best.x;this.signal.handY=best.y;
    this.signal.handVisible=true;this.lastHandSeen=now;
  }
}
