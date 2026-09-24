import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";

// Tests never call a real model: by default the server reports no model configured.
test.beforeEach(async({page})=>{ await page.route("**/api/model",r=>r.fulfill({json:{configured:false}})); });

test("sample playback, review, analytics, theme and CSV", async ({page})=>{
 await page.goto("/");
 await expect(page.getByRole("heading",{name:"Overview"})).toBeVisible();
 await expect(page.getByText("Suspected incidents",{exact:true}).first()).toBeVisible();
 await page.getByRole("link",{name:"Video library"}).first().click();
 await expect(page.getByRole("heading",{name:"Video library"})).toBeVisible();
 await page.getByRole("link",{name:"Review",exact:true}).first().click();
 await expect(page.getByText("Recorded playback",{exact:true}).first()).toBeVisible();
 const video=page.locator("video").first();
 await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.duration)).toBeGreaterThan(20);
 await page.getByRole("button",{name:/Seek to/}).first().click();
 await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(4);
 await video.evaluate((v:HTMLVideoElement)=>v.pause());
 await expect(page.locator(".video-box")).toHaveCount(1);
 await page.getByRole("button",{name:"Fullscreen"}).click();
 await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);
 const overlay=await page.locator(".video-box").first().boundingBox();
 const canvas=await page.locator(".video-canvas").boundingBox();
 expect(overlay && canvas && overlay.x>=canvas.x && overlay.y>=canvas.y && overlay.x+overlay.width<=canvas.x+canvas.width).toBeTruthy();
 await page.evaluate(()=>document.exitFullscreen());
 await page.getByRole("button",{name:"Mark reviewed"}).first().click();
 await expect(page.getByText("reviewed",{exact:true}).first()).toBeVisible();
 await page.getByRole("link",{name:"Detection log"}).first().click();
 await expect(page.getByRole("heading",{name:"Detection log"})).toBeVisible();
 await page.getByRole("combobox",{name:"Filter category"}).selectOption("Shoplifting");
 await expect(page.locator("tbody tr")).toHaveCount(1);
 await page.getByRole("link",{name:"Analytics"}).first().click();
 await expect(page.getByRole("heading",{name:"Analytics"})).toBeVisible();
 await page.getByRole("combobox",{name:"Filter analytics category"}).selectOption("Shoplifting");
 await expect(page.locator("tbody tr")).toHaveCount(1);
 const download=page.waitForEvent("download");
 await page.getByRole("button",{name:"Export filtered CSV"}).click();
 const saved=await download;
 expect(saved.suggestedFilename()).toContain("kryptonxwatch");
 const csv=await readFile(await saved.path(),"utf8");
 expect(csv).toContain("Shoplifting");
 expect(csv).not.toContain("Kiosk nonpayment");
 await page.getByRole("link",{name:"Preferences"}).first().click();
 await page.getByRole("button",{name:"Dark",exact:true}).click();
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await page.reload();
 await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
});

test("upload persists across reload without fabricated analysis, then delete",async({page})=>{
 await page.goto("/upload");
 const file=path.resolve("public/samples/market-entrance.webm");
 await page.locator('input[type="file"]').setInputFiles(path.resolve("README.md"));
 await expect(page.getByText("Choose an MP4 or WebM video.")).toBeVisible();
 await page.locator('input[type="file"]').setInputFiles(file);
 await expect(page.getByText("market-entrance.webm")).toBeVisible();
 await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThan(0);
 await page.getByRole("button",{name:"Save recording"}).click();
 await expect(page).toHaveURL(/\/videos\//);
 await expect(page.getByText("this upload has no detection analysis")).toBeVisible();
 await expect(page.getByText("No detections yet")).toBeVisible();
 await page.reload();
 await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThan(0);
 await expect(page.getByText("No detections yet")).toBeVisible();
 const playbackSource=await page.locator("video").getAttribute("src");
 await page.locator("video").evaluate((v:HTMLVideoElement)=>{v.currentTime=4;v.pause()});
 await page.getByRole("button",{name:"Rename"}).click();
 await page.getByRole("textbox",{name:"Recording name"}).fill("renamed upload");
 await page.getByRole("button",{name:"Save name"}).click();
 await expect(page.locator("video")).toHaveAttribute("src",playbackSource!);
 await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(3);
 await page.getByRole("link",{name:"Video library"}).first().click();
 page.once("dialog",dialog=>dialog.accept());
 await page.getByRole("button",{name:"Delete renamed upload"}).click();
 await expect(page.getByRole("link",{name:"renamed upload",exact:true})).toHaveCount(0);
});


test("storage quota errors show an actionable message",async({page})=>{
 await page.goto("/upload");
 await page.locator('input[type="file"]').setInputFiles(path.resolve("public/samples/self-checkout.webm"));
 await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThan(0);
 await page.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException("Quota exceeded","QuotaExceededError")};});
 await page.getByRole("button",{name:"Save recording"}).click();
 await expect(page.getByText("Browser storage is full.",{exact:false}).first()).toBeVisible();
 await expect(page).toHaveURL(/\/upload$/);
});

test("AI analysis of an upload with a mocked model: progress, detections, scene log, assistant, reload",async({page})=>{
 await page.route("**/api/model",r=>r.fulfill({json:{configured:true,model:"mock/vlm",chatModel:"mock/vlm",provider:"Mock"}}));
 let calls=0;
 await page.route("**/api/analyze",async r=>{const body=r.request().postDataJSON();calls++;const hit=body.start>=8&&body.start<16;
  await r.fulfill({json:{start:body.start,end:body.end,summary:hit?"A person conceals an item in a jacket.":"People browse the aisle.",score:hit?0.9:0,model:"mock/vlm",
   incidents:hit?[{category:"Shoplifting",severity:"medium",confidence:0.9,seconds:body.frames[1].seconds,description:"Person conceals an item in a jacket",box:{x:.2,y:.2,width:.3,height:.5,label:"Shoplifting"}}]:[]}});});
 await page.route("**/api/chat",r=>r.fulfill({json:{text:"Suspected shoplifting at [00:09]. Review the footage before acting.",references:[{seconds:9,label:"00:09"}],model:"mock/vlm"}}));
 await page.goto("/upload");
 await page.locator('input[type="file"]').setInputFiles(path.resolve("public/samples/market-entrance.webm"));
 await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.readyState)).toBeGreaterThan(0);
 await expect(page.getByText("Run AI analysis after saving")).toBeVisible();
 await page.getByRole("button",{name:"Save recording"}).click();
 await expect(page).toHaveURL(/analyze=1/);
 await expect(page.getByRole("button",{name:"Re-run analysis"})).toBeVisible({timeout:20000});
 expect(calls).toBeGreaterThan(1);
 await expect(page.getByText("Suspected shoplifting").first()).toBeVisible();
 await expect(page.getByText("Model confidence 90%")).toBeVisible();
 await expect(page.getByText("A person conceals an item in a jacket.")).toBeVisible();
 await page.getByLabel("Ask assistant").fill("What happened?");
 await page.getByLabel("Send question").click();
 await expect(page.getByText("Review the footage before acting.")).toBeVisible();
 await page.getByRole("button",{name:"00:09",exact:true}).click();
 await page.reload();
 await expect(page.getByText("Suspected shoplifting").first()).toBeVisible();
 await page.getByRole("link",{name:"Detection log"}).first().click();
 await expect(page.getByText("Person conceals an item in a jacket").first()).toBeVisible();
});
