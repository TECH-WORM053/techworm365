import { writeFile, mkdir } from "node:fs/promises";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { createSilverVineGlasses } from "./eyewear-model.js";

globalThis.FileReader=class{
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.({target:this})})}
  readAsDataURL(blob){blob.arrayBuffer().then(buffer=>{this.result=`data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;this.onloadend?.({target:this})})}
};

const {root}=createSilverVineGlasses();
root.updateMatrixWorld(true);
const exporter=new GLTFExporter();
const binary=await exporter.parseAsync(root,{binary:true,trs:true,onlyVisible:false,maxTextureSize:1024});
await mkdir(new URL("./assets/models/",import.meta.url),{recursive:true});
await writeFile(new URL("./assets/models/silver-vine-glasses.glb",import.meta.url),Buffer.from(binary));
console.log(`Exported silver-vine-glasses.glb (${binary.byteLength} bytes)`);
