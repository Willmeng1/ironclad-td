const {chromium}=require('/Users/will/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1000,height:650}});
 await page.goto('http://127.0.0.1:3002/');
 await page.addScriptTag({url:'/stage-maps-v3.js'});
 for(let i=1;i<=15;i++){
   await page.evaluate(async(id)=>{
     const image=new Image();image.src=`/assets/stage-backgrounds/stage-${String(id).padStart(2,'0')}.webp`;await image.decode();
     let c=document.querySelector('#guide');if(!c){c=document.createElement('canvas');c.id='guide';c.width=1000;c.height=650;c.style='position:fixed;left:0;top:0;width:1000px;height:650px;z-index:999999';document.body.append(c);}
     const x=c.getContext('2d');x.drawImage(image,0,0,1000,650);x.lineCap='butt';x.lineJoin='round';
     for(const road of window.STAGE_MAP_LAYOUTS_V3[id-1]){x.beginPath();road.forEach(([a,b],j)=>j?x.lineTo(a,b):x.moveTo(a,b));x.strokeStyle='#785c3d';x.lineWidth=54;x.stroke();x.strokeStyle='#c9ae7e';x.lineWidth=48;x.stroke();}
   },i);
   await page.locator('#guide').screenshot({path:`assets/stage-maps-v3/guides/stage-${String(i).padStart(2,'0')}.png`});
 }
 await browser.close();
})();
