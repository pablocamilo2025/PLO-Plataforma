import {chromium} from 'playwright-core';
import {canonicalURL,extractOffer} from './extract.mjs';
export async function scrape(target,env=process.env){
 canonicalURL(target.source,target.url);
 if(!env.BROWSERBASE_API_KEY||!env.BROWSERBASE_PROJECT_ID)throw Error('PROVIDER_NOT_CONFIGURED');
 const headers={'X-BB-API-Key':env.BROWSERBASE_API_KEY,'Content-Type':'application/json'};
 let session,browser;
 try{
  const response=await fetch('https://api.browserbase.com/v1/sessions',{method:'POST',headers,signal:AbortSignal.timeout(20000),body:JSON.stringify({projectId:env.BROWSERBASE_PROJECT_ID,timeout:180,browserSettings:{solveCaptchas:false},proxies:false})});
  if(!response.ok)throw Error('PROVIDER_CREATE_FAILED');
  session=await response.json();
  browser=await chromium.connectOverCDP(session.connectUrl,{timeout:20000});
  const context=browser.contexts()[0];const page=context.pages()[0]||await context.newPage();
  page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(35000);
  await page.goto(target.url,{waitUntil:'domcontentloaded'});
  // Prevent publishing a redirected or changed product even if its price looks valid.
  canonicalURL(target.source,page.url());
  if(target.source==='cruzverde'){
   const inventory=page.getByText('Inventario de Las Condes',{exact:true});
   if(!await inventory.isVisible()){
    const region=page.locator('xpath=//label[normalize-space()="Región"]/..//div[contains(@class,"select-options-input")]').filter({visible:true});
    await region.click();
    await page.locator('xpath=//label[normalize-space()="Región"]/..//div[contains(@class,"select-option-container")]/div[normalize-space()="Región Metropolitana"]').filter({visible:true}).click();
    // Selecting region opens Comuna automatically. Do not toggle the input again.
    await page.locator('xpath=//label[normalize-space()="Comuna"]/..//div[contains(@class,"select-option-container")]/div[normalize-space()="Las Condes"]').filter({visible:true}).click();
    await page.getByRole('button',{name:'Aceptar',exact:true}).filter({visible:true}).click();
   }
   await inventory.waitFor({state:'visible'});
  }
  await page.locator('h1').first().waitFor({state:'visible'});
  let result,lastError;
  // Bounded hydration retries: no blind publication of an empty or partial page.
  for(let n=0;n<5;n++){
   const snapshot=await page.evaluate(()=>({url:location.href,headings:Array.from(document.querySelectorAll('h1')).map(e=>e.innerText),body:document.body.innerText}));
   try{result=extractOffer(target,snapshot);break;}catch(e){lastError=e;if(n<4)await new Promise(r=>setTimeout(r,2000));}
  }
  if(!result)throw lastError;
  return result;
 }finally{
  // Explicitly release paid remote resources even after parse or navigation failure.
  if(browser)await browser.close().catch(()=>{});
  if(session?.id){
   const r=await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(session.id)}`,{method:'POST',headers,signal:AbortSignal.timeout(10000),body:JSON.stringify({projectId:env.BROWSERBASE_PROJECT_ID,status:'REQUEST_RELEASE'})}).catch(()=>null);
   if(!r?.ok)console.error('RADAR_SESSION_RELEASE_FAILED');
  }
 }
}
