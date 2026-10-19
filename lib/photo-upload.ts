export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const supported = ["image/jpeg", "image/png", "image/webp"];
/** Create a smaller copy for local demo storage; leave the original file untouched. */
export async function preparePhoto(file: File): Promise<string> {
 if (!supported.includes(file.type)) throw new Error("Choose a JPG, PNG or WebP photo.");
 if (file.size > MAX_PHOTO_BYTES) throw new Error("Choose a photo up to 10 MB.");
 const url = URL.createObjectURL(file);
 try {
  const img = await new Promise<HTMLImageElement>((resolve,reject)=>{
   const image = new Image(); image.onload=()=>resolve(image); image.onerror=()=>reject(new Error("Could not open this photo. Try another JPG, PNG or WebP image."));image.src=url;
  });
  if (!img.naturalWidth || !img.naturalHeight) throw new Error("This photo could not be read.");
  const canvas=document.createElement("canvas"), context=canvas.getContext("2d");
  if (!context) throw new Error("Photo processing is unavailable in this browser.");
  let scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
  for(let attempt=0;attempt<6;attempt++) {
   canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
   context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
   for(const quality of [0.85,0.72,0.6]) {
    const data=canvas.toDataURL("image/jpeg",quality);
    if(data.startsWith("data:image/jpeg;base64,") && data.length<=350000) return data;
   }
   scale*=0.8;
  }
  throw new Error("Could not reduce this photo enough to save. Try a smaller image.");
 } finally { URL.revokeObjectURL(url); }
}
