const { chromium } = require('/Users/will/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1500,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3002/?laptop=1');
 await page.waitForFunction(()=>typeof levelData!=='undefined'&&levelData.every(l=>stageBackgroundImage(l.id)));
 const report=await page.evaluate(()=>levelData.map(l=>{
   state.currentLevel=l;
   let valid=true;
   const ring=towerSelectionRing('dart');
   for(let p=0;p<l.paths.length;p++){
     const path=l.paths[p];const mob={x:path[0][0],y:path[0][1],waypoint:1,pathIndex:p};
     for(const [x,y] of path) if(!towerRoadOverlaps(x-ring.x,y-ring.y,'dart'))valid=false;
     let progress=0;
     while(progress<pathLength(path)){
       const step=Math.min(7,pathLength(path)-progress);moveMob(mob,step);progress+=step;
       const point=pointOnPath(path,progress);
       if(Math.hypot(point.x-mob.x,point.y-mob.y)>0.001)valid=false;
     }
     if(Math.hypot(mob.x-BASE_GATE[0],mob.y-BASE_GATE[1])>0.01)valid=false;
   }
   const image=stageBackgroundImage(l.id);
   return {id:l.id,roads:l.paths.length,valid,ratio:image.naturalWidth/image.naturalHeight};
 }));
 assert.deepEqual(report.map(r=>r.roads),[1,1,1,1,2,2,2,2,3,3,3,3,3,3,3]);
 assert.ok(report.every(r=>r.valid&&Math.abs(r.ratio-1000/650)<0.005));
 await page.click('#playAsGuest');
 await page.evaluate(()=>{state.clearedStages=new Set(levelData.map(l=>l.id));startLevel(15);});
 await page.screenshot({path:'/private/tmp/maps-v3-stage15.png'});
 await page.evaluate(()=>{
  state.screen='home';
  const grid=document.createElement('div');grid.id='map-check';grid.style='position:absolute;inset:0 auto auto 0;z-index:999999;background:#101820;width:1500px;display:grid;grid-template-columns:repeat(3,500px)';
  levelData.forEach(l=>{
   const card=document.createElement('div');card.style='color:white;font:16px sans-serif';card.textContent=`Stage ${l.id} · ${l.paths.length} roads`;
   const c=document.createElement('canvas');c.width=1000;c.height=650;c.style='width:500px;height:325px;display:block';
   const x=c.getContext('2d');x.drawImage(stageBackgroundImage(l.id),0,0,1000,650);
   x.strokeStyle='#ff00df';x.lineWidth=2;
   l.paths.forEach(path=>{x.beginPath();path.forEach(([a,b],i)=>i?x.lineTo(a,b):x.moveTo(a,b));x.stroke();});
   card.append(c);grid.append(card);
  });document.body.append(grid);
 });
 await page.locator('#map-check').screenshot({path:'/private/tmp/maps-v3-alignment.png'});
 assert.deepEqual(errors,[]);console.log('PASS',JSON.stringify(report));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
