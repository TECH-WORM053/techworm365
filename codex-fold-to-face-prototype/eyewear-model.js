import * as THREE from "./vendor/three/three.module.min.js";

function tube(points,radius,material,closed=false){
  const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed,"catmullrom",.35);
  return new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(24,points.length*10),radius,7,closed),material);
}
function roundedRectPoints(width,height,radius,z=0){
  const points=[];const corners=[[width/2-radius,height/2-radius,0],[-width/2+radius,height/2-radius,Math.PI/2],[-width/2+radius,-height/2+radius,Math.PI],[width/2-radius,-height/2+radius,Math.PI*1.5]];
  for(const [cx,cy,start] of corners)for(let i=0;i<8;i++){const a=start+i/7*Math.PI/2;points.push([cx+Math.cos(a)*radius,cy+Math.sin(a)*radius,z])}
  return points;
}

export function createSilverVineGlasses(){
  const root=new THREE.Group();root.name="Silver_Vine_Glasses";
  const metal=new THREE.MeshStandardMaterial({name:"Polished_Silver",color:0xe8ebec,metalness:1,roughness:.12});
  const lensMaterial=new THREE.MeshPhysicalMaterial({name:"Clear_Lens",color:0xdce8e7,roughness:.08,transmission:.82,transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false});
  const frame=new THREE.Group();frame.name="Frame";root.add(frame);
  const lensWidth=1.22,lensHeight=.55,corner=.13;
  for(const side of [-1,1]){
    const x=side*.68;const rim=tube(roundedRectPoints(lensWidth,lensHeight,corner),.025,metal,true);rim.position.x=x;rim.name=side<0?"Rim_L":"Rim_R";frame.add(rim);
    const shape=new THREE.Shape();shape.moveTo(-lensWidth/2+corner,lensHeight/2);shape.lineTo(lensWidth/2-corner,lensHeight/2);shape.quadraticCurveTo(lensWidth/2,lensHeight/2,lensWidth/2,lensHeight/2-corner);shape.lineTo(lensWidth/2,-lensHeight/2+corner);shape.quadraticCurveTo(lensWidth/2,-lensHeight/2,lensWidth/2-corner,-lensHeight/2);shape.lineTo(-lensWidth/2+corner,-lensHeight/2);shape.quadraticCurveTo(-lensWidth/2,-lensHeight/2,-lensWidth/2,-lensHeight/2+corner);shape.lineTo(-lensWidth/2,lensHeight/2-corner);shape.quadraticCurveTo(-lensWidth/2,lensHeight/2,-lensWidth/2+corner,lensHeight/2);
    const lens=new THREE.Mesh(new THREE.ShapeGeometry(shape,16),lensMaterial);lens.position.set(x,0,-.015);lens.name=side<0?"Lens_L":"Lens_R";frame.add(lens);
  }
  const bridge=tube([[-.07,.03,0],[-.04,.12,.01],[.04,.12,.01],[.07,.03,0]],.027,metal);bridge.name="Bridge";frame.add(bridge);
  for(const side of [-1,1]){
    const pad=tube([[side*.12,-.02,-.02],[side*.16,-.18,-.09],[side*.2,-.23,-.05]],.018,metal);frame.add(pad);
    const padDisc=new THREE.Mesh(new THREE.SphereGeometry(.07,14,8),new THREE.MeshPhysicalMaterial({color:0xffffff,transparent:true,opacity:.28,roughness:.2}));padDisc.scale.set(.55,1,.28);padDisc.position.set(side*.2,-.23,-.05);frame.add(padDisc);
  }
  const makeTemple=side=>{
    const pivot=new THREE.Group();pivot.name=side<0?"Temple_L":"Temple_R";pivot.position.set(side*1.3,.03,-.01);
    const paths=[
      [[0,0,0],[side*.12,.12,-.18],[side*.16,.2,-.42],[side*.28,.08,-.68],[side*.3,.18,-.94],[side*.42,.03,-1.22],[side*.48,-.02,-1.62]],
      [[0,-.03,.01],[side*.08,-.16,-.22],[side*.15,-.08,-.48],[side*.24,.06,-.74],[side*.28,-.05,-1.02],[side*.4,-.09,-1.35]],
      [[side*.02,.04,-.02],[side*.1,-.02,-.25],[side*.18,.1,-.52],[side*.26,.16,-.78],[side*.34,.02,-1.03],[side*.44,-.04,-1.3]]
    ];
    paths.forEach((path,i)=>{const wire=tube(path,i===0?.026:.018,metal);wire.name=`Vine_Wire_${i+1}`;pivot.add(wire)});
    [[.1,.12,-.2],[.18,-.07,-.48],[.12,.12,-.77],[.16,-.03,-1.05]].forEach((p,i)=>{const bead=new THREE.Mesh(new THREE.SphereGeometry(i%2?.035:.05,12,8),metal);bead.position.set(side*p[0],p[1],p[2]);pivot.add(bead)});
    const tip=tube([[side*.4,-.02,-1.35],[side*.5,-.02,-1.7],[side*.58,-.08,-1.95],[side*.62,-.19,-2.12]],.038,metal);tip.name="Ear_Tip";pivot.add(tip);
    const hinge=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.13,12),metal);hinge.rotation.x=Math.PI/2;hinge.name="Hinge";pivot.add(hinge);root.add(pivot);return pivot;
  };
  const leftArm=makeTemple(-1),rightArm=makeTemple(1);root.userData.model="Codex Silver Vine 001";return{root,leftArm,rightArm};
}
