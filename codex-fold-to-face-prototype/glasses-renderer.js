import * as THREE from "./vendor/three/three.module.min.js";
import { createSilverVineGlasses } from "./eyewear-model.js";

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=t=>1-Math.pow(1-clamp(t),3);
const lerp=(a,b,t)=>a+(b-a)*t;

function ellipseTube(rx,ry,material){
  const points=[];
  for(let i=0;i<48;i++){const a=i/48*Math.PI*2;points.push(new THREE.Vector3(Math.cos(a)*rx,Math.sin(a)*ry,0))}
  return new THREE.Mesh(new THREE.CatmullRomCurve3(points,true),material);
}

export class GlassesRenderer{
  constructor(host){
    this.host=host; this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2)); this.renderer.outputColorSpace=THREE.SRGBColorSpace; host.append(this.renderer.domElement);
    this.scene=new THREE.Scene(); this.camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100); this.camera.position.z=10;
    this.scene.add(new THREE.HemisphereLight(0xffffff,0x222222,2.2)); const key=new THREE.DirectionalLight(0xffffff,4);key.position.set(-2,3,5);this.scene.add(key);
    this.glasses=this.build(); this.scene.add(this.glasses); this.state="FOLDED"; this.since=performance.now(); this.face=null;this.manualOpen=1;this.headEuler=new THREE.Euler();this.headMatrix=new THREE.Matrix4();
    this.resize(); addEventListener("resize",()=>this.resize());
  }
  build(){
    const model=createSilverVineGlasses();this.leftArm=model.leftArm;this.rightArm=model.rightArm;model.root.rotation.x=-.08;return model.root;
  }
  resize(){const w=this.host.clientWidth,h=this.host.clientHeight;this.renderer.setSize(w,h,false);const a=w/h;this.camera.left=-a;this.camera.right=a;this.camera.top=1;this.camera.bottom=-1;this.camera.updateProjectionMatrix();this.aspect=a}
  setState(name,now){if(this.state!==name){this.state=name;this.since=now;this.onState?.(name)}}
  replay(){this.forceReplay=true;this.setState("FOLDED",performance.now())}
  mapVideoPoint(x,y,f){
    const width=this.host.clientWidth,height=this.host.clientHeight;
    const videoWidth=f.videoWidth||width,videoHeight=f.videoHeight||height;
    const cover=Math.max(width/videoWidth,height/videoHeight);
    const offsetX=(width-videoWidth*cover)/2,offsetY=(height-videoHeight*cover)/2;
    const pixelX=offsetX+x*videoWidth*cover,pixelY=offsetY+y*videoHeight*cover;
    return {x:(pixelX-width/2)*2/height,y:-(pixelY-height/2)*2/height,cover,height,videoWidth};
  }
  update(face,now){
    this.face=face;const elapsed=now-this.since;
    if(this.state==="FOLDED"&&face.visible&&elapsed>500)this.setState("OPENING",now);
    else if(this.state==="OPENING"&&elapsed>1050)this.setState("FLYING",now);
    else if(this.state==="FLYING"&&elapsed>950)this.setState("WORN",now);
    else if(this.state==="WORN"&&!face.visible)this.setState("CLOSING",now);
    else if(this.state==="CLOSING"&&face.visible)this.setState("OPENING",now);
    else if(this.state==="CLOSING"&&elapsed>900)this.setState("FOLDED",now);
    if(this.state==="WORN"&&face.handVisible){
      const near=Math.hypot((face.handX-face.x)/Math.max(face.width,.1),(face.handY-face.y)/Math.max(face.width,.1))<2.1;
      if(near){this.manualOpen=lerp(this.manualOpen,face.handOpen,.32);this.onGesture?.(this.manualOpen)}
    }
    this.pose(now);this.renderer.render(this.scene,this.camera);
  }
  pose(now){
    const t=now-this.since, f=this.face;
    let open=0,attach=0;
    if(this.state==="OPENING"){open=ease(t/1050)}
    if(this.state==="FLYING"){open=1;attach=ease(t/950)}
    if(this.state==="WORN"){open=this.manualOpen;attach=1}
    if(this.state==="CLOSING"){const q=ease(t/900);open=1-q;attach=1-q}
    this.leftArm.rotation.y=lerp(-1.48,0,open);this.rightArm.rotation.y=lerp(1.48,0,open);
    const idleX=0,idleY=.03+Math.sin(now*.001)*.025,idleScale=.48;
    const mapped=this.mapVideoPoint(f.x,f.y,f),worldX=mapped.x,worldY=mapped.y;
    const eyeWidthPixels=f.eyeWidth*mapped.videoWidth*mapped.cover;
    const yawForScale=clamp(f.yaw,-1.05,1.05);
    const projectionCorrection=1/Math.max(.58,Math.cos(yawForScale));
    const desiredFrameWidth=eyeWidthPixels*1.2*projectionCorrection;
    const faceScale=clamp((desiredFrameWidth*2/mapped.height)/2.76,.12,.68);
    this.glasses.position.set(lerp(idleX,worldX,attach),lerp(idleY,worldY,attach),lerp(0,1,attach));
    const s=lerp(idleScale,faceScale,attach);this.glasses.scale.setScalar(s);
    const headYaw=clamp(f.yaw,-1.12,1.12),headPitch=clamp(f.pitch,-.48,.48),headRoll=-f.tilt;
    this.glasses.rotation.z=lerp(.08,headRoll,attach);this.glasses.rotation.y=lerp(-.48,headYaw,attach);
    this.glasses.rotation.x=lerp(-.14,headPitch,attach);
    const sideAmount=Math.abs(headYaw);
    this.leftArm.visible=sideAmount<.22||headYaw>0;
    this.rightArm.visible=sideAmount<.22||headYaw<0;
  }
}
