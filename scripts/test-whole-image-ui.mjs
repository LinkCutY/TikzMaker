import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
if(!process.argv[2])throw Error('Pass a local multi-region image fixture path');
const browser=await puppeteer.launch({executablePath:process.env.TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-gpu']});
try{
  const page=await browser.newPage(),calls=[];
  await page.evaluateOnNewDocument(()=>{
    const raw=localStorage.getItem('tikz-studio:v1');const store=raw?JSON.parse(raw):{state:{},version:1};
    store.state.settings={...store.state.settings,apiKey:'local-test-placeholder',apiBaseUrl:'http://127.0.0.1:1',apiModel:'deepseek-flash'};
    localStorage.setItem('tikz-studio:v1',JSON.stringify(store));
  });
  await page.setRequestInterception(true);
  page.on('request',r=>{
    if(r.url().includes('/api/ai/text2tikz')){
      calls.push(JSON.parse(r.postData()));void r.respond({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'done',ok:false,reason:'TIME_BUDGET',code:''})+'\n\n'});
    }else if(r.url().includes('/api/ai/'))void r.respond({status:200,contentType:'application/json',body:'{"models":[],"meta":[]}'});
    else void r.continue();
  });
  await page.goto('http://127.0.0.1:5188',{waitUntil:'networkidle2'});
  await page.evaluate(()=>[...document.querySelectorAll('.topbar button')].find(b=>b.textContent.includes('文生 TikZ'))?.click());
  await page.waitForSelector('.drawer');
  await page.evaluate(()=>[...document.querySelectorAll('.drawer button')].find(b=>b.textContent.includes('图片识别'))?.click());
  await (await page.$('.drawer input[type="file"]')).uploadFile(process.argv[2]);
  await page.waitForFunction(()=>document.querySelector('.drawer')?.textContent.includes('个候选区域'));
  assert.equal(await page.$eval('.drawer details.notice',e=>e.open),false);
  await page.evaluate(()=>[...document.querySelectorAll('.drawer button')].find(b=>b.textContent.includes('理解并生成 TikZ'))?.click());
  await page.waitForFunction(()=>document.querySelector('.drawer')?.textContent.includes('时间'));
  assert.equal(calls.length,1);assert.equal(calls[0].perPanel,undefined);assert.equal(calls[0].mode,'image');assert.ok(calls[0].image.startsWith('data:image/png;base64,'));
  console.log('UI regression passed: detected regions, collapsed optional split, one whole-image request from primary button; no external API calls');
}finally{await browser.close();}
