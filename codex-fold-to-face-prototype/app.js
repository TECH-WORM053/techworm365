import { FaceTracker } from "./vision-engine.js";

const $=id=>document.getElementById(id);
const video=$("camera"),intro=$("intro"),guide=$("guide"),status=$("status"),dot=$("dot"),state=$("state"),replay=$("replay"),errorBox=$("error"),startButton=$("start");
const handCanvas=$("handFx"),handContext=handCanvas.getContext("2d");
const faceSize=$("faceSize"),facePose=$("facePose");
let tracker=null,glasses=null,running=false,starting=false;
let handGlow=0;

function drawHandBlobs(signal){
  const width=handCanvas.clientWidth,height=handCanvas.clientHeight,dpr=Math.min(devicePixelRatio,2);
  if(handCanvas.width!==Math.round(width*dpr)||handCanvas.height!==Math.round(height*dpr)){handCanvas.width=Math.round(width*dpr);handCanvas.height=Math.round(height*dpr)}
  handContext.setTransform(dpr,0,0,dpr,0,0);handContext.clearRect(0,0,width,height);
  handGlow+=((signal.handVisible?1:0)-handGlow)*.18;if(handGlow<.01&&!signal.visible)return;
  const vw=video.videoWidth||width,vh=video.videoHeight||height,scale=Math.max(width/vw,height/vh),ox=(width-vw*scale)/2,oy=(height-vh*scale)/2;
  const mapPoint=p=>({x:ox+p.x*vw*scale,y:oy+p.y*vh*scale});
  if(signal.visible&&signal.facePoints.length){
    const points=signal.facePoints.map(mapPoint);
    handContext.globalCompositeOperation="lighter";handContext.globalAlpha=.82;handContext.filter="blur(2px)";
    handContext.fillStyle="rgba(68,205,255,.46)";handContext.shadowColor="rgba(44,170,255,.9)";handContext.shadowBlur=11;
    handContext.beginPath();for(let i=0;i<points.length;i+=2){const p=points[i];handContext.moveTo(p.x+2.1,p.y);handContext.arc(p.x,p.y,2.1,0,Math.PI*2)}handContext.fill();
    const drawPath=(indices,color,widthValue,close=false)=>{handContext.strokeStyle=color;handContext.lineWidth=widthValue;handContext.beginPath();indices.forEach((index,i)=>{const p=points[index];if(i)handContext.lineTo(p.x,p.y);else handContext.moveTo(p.x,p.y)});if(close)handContext.closePath();handContext.stroke()};
    drawPath([10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109],"rgba(74,220,255,.72)",1.4,true);
    drawPath([33,160,158,133,153,144],"rgba(216,255,62,.9)",2,true);drawPath([263,387,385,362,380,373],"rgba(216,255,62,.9)",2,true);
    if(signal.faceAnchor){
      const anchor=mapPoint(signal.faceAnchor);handContext.fillStyle="rgba(255,80,210,.95)";handContext.shadowColor="rgba(255,40,190,1)";handContext.shadowBlur=18;handContext.beginPath();handContext.arc(anchor.x,anchor.y,6,0,Math.PI*2);handContext.fill();
    }
    handContext.shadowBlur=0;handContext.filter="none";handContext.globalAlpha=1;
  }
  handContext.globalCompositeOperation="lighter";handContext.globalAlpha=handGlow;
  for(const hand of signal.hands){
    const points=hand.map(p=>({x:ox+p.x*vw*scale,y:oy+p.y*vh*scale}));
    handContext.filter="blur(13px)";
    for(let i=0;i<points.length;i++){
      const p=points[i],radius=i===4||i===8?28:18;
      const gradient=handContext.createRadialGradient(p.x,p.y,0,p.x,p.y,radius);
      gradient.addColorStop(0,"rgba(216,255,62,.9)");gradient.addColorStop(.45,"rgba(75,255,205,.42)");gradient.addColorStop(1,"rgba(35,255,190,0)");
      handContext.fillStyle=gradient;handContext.beginPath();handContext.arc(p.x,p.y,radius,0,Math.PI*2);handContext.fill();
    }
    const thumb=points[4],index=points[8];handContext.strokeStyle="rgba(216,255,62,.8)";handContext.lineWidth=12;handContext.lineCap="round";handContext.beginPath();handContext.moveTo(thumb.x,thumb.y);handContext.lineTo(index.x,index.y);handContext.stroke();
    handContext.filter="none";handContext.fillStyle="rgba(245,255,210,.95)";
    for(const p of [thumb,index]){handContext.beginPath();handContext.arc(p.x,p.y,4,0,Math.PI*2);handContext.fill()}
  }
  handContext.globalAlpha=1;handContext.globalCompositeOperation="source-over";handContext.filter="none";
}

function explain(error){
  const name=error?.name||"Error";
  if(name==="NotAllowedError")return "카메라 권한이 차단됐습니다. 주소창 왼쪽의 카메라 아이콘 → 허용으로 바꾼 뒤 다시 눌러주세요.";
  if(name==="NotFoundError")return "연결된 카메라를 찾지 못했습니다. 웹캠 케이블과 Windows 카메라 설정을 확인해주세요.";
  if(name==="NotReadableError")return "다른 프로그램이 카메라를 사용 중입니다. 카메라 앱·Zoom·Discord 등을 닫고 다시 시도해주세요.";
  if(name==="SecurityError"||!window.isSecureContext)return "카메라는 http://127.0.0.1:5186 주소에서 열어야 합니다. HTML 파일을 직접 열면 동작하지 않습니다.";
  return `시작 오류: ${error?.message||name}`;
}
function showError(error){
  errorBox.textContent=explain(error);errorBox.classList.add("show");status.textContent="START ERROR";
  startButton.disabled=false;startButton.textContent="다시 시도";starting=false;console.error(error);
}
async function start(){
  if(starting||running)return;
  starting=true;startButton.disabled=true;errorBox.classList.remove("show");
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new DOMException("이 주소에서는 카메라 API를 사용할 수 없습니다.","SecurityError");
    status.textContent="CAMERA REQUEST";
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:"user"},audio:false});
    video.srcObject=stream;await video.play();status.textContent="LOADING 3D";
    const { GlassesRenderer }=await import("./glasses-renderer.js");
    glasses=new GlassesRenderer($("three"));
    glasses.onState=name=>{state.textContent=name;replay.hidden=name!=="WORN"};
    glasses.onGesture=amount=>{state.textContent=amount<.2?"HAND / FOLDED":amount>.8?"HAND / OPEN":"HAND / FOLDING"};
    intro.classList.add("hide");status.textContent="LOADING VISION";
    tracker=new FaceTracker(video);await tracker.init();
    running=true;starting=false;dot.classList.add("live");status.textContent="LIVE / LOCAL";loop(performance.now());
  }catch(error){
    video.srcObject?.getTracks().forEach(track=>track.stop());video.srcObject=null;showError(error);
  }
}
function loop(now){
  if(!running)return;
  const signal=tracker.update(now);guide.classList.toggle("show",!signal.visible);drawHandBlobs(signal);
  faceSize.textContent=signal.visible?`${(signal.eyeWidth*100).toFixed(1)} / ${(signal.width*100).toFixed(1)}`:"—";
  facePose.textContent=signal.visible?`${(signal.yaw*57.3).toFixed(0)}° / ${(-signal.tilt*57.3).toFixed(0)}°`:"—";
  glasses.update(signal,now);requestAnimationFrame(loop);
}
startButton.addEventListener("click",start);
replay.addEventListener("click",()=>glasses?.replay());
