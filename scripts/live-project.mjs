// Acceptance runs use the same HTTP/SSE route as AiDrawer. No private renderer,
// no screenshots, no model mocks: the project owns compilation and visual review.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const imagePath = process.env.TEST_IMAGE;
if (!imagePath) throw new Error('TEST_IMAGE is required');
const secret = process.env.TIKZ_AI_KEY || (await readFile(process.env.TIKZ_AI_KEY_FILE, 'utf8')).trim();
const apiKey = secret.match(/sk-[A-Za-z0-9_-]+/)?.[0];
if (!apiKey) throw new Error('API credential missing');
const output = path.resolve('.probe-tests/live', process.env.TEST_LABEL || 'project');
await mkdir(output, { recursive: true });
const image = 'data:image/png;base64,' + (await readFile(imagePath)).toString('base64');
const started = Date.now();
const response = await fetch((process.env.TEST_SERVER || 'http://127.0.0.1:8792') + '/api/ai/text2tikz', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-key': apiKey },
  body: JSON.stringify({ mode: 'image', image, representation: 'figure', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash',
    canvasMode: true, engine: 'xelatex', maxAttempts: Number(process.env.TEST_ROUNDS || 1), budgetMs: 180000, reviewer: true }),
  signal: AbortSignal.timeout(190000),
});
if (!response.ok) throw new Error('Project HTTP ' + response.status);
const decoder = new TextDecoder(); let pending = ''; let done; const events = [];
for await (const chunk of response.body) {
  pending += decoder.decode(chunk, { stream: true });
  let boundary;
  while ((boundary = pending.indexOf('\n\n')) >= 0) {
    const packet = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
    if (!packet.startsWith('data: ')) continue;
    const event = JSON.parse(packet.slice(6));
    if (event.type === 'code') continue;
    if (event.type === 'done') { done = event; continue; }
    events.push(event);
    if (event.type === 'step' || event.type === 'error') console.log(JSON.stringify(event));
  }
}
if (done?.code) await writeFile(path.join(output, 'result.tex'), done.code);
const testChecks=[];
const expect=(name,actual,expected)=>testChecks.push({name,actual,expected,pass:JSON.stringify(actual)===JSON.stringify(expected)});
if(process.env.TEST_EXPECT_OBSERVATIONS) expect('observation count',(done?.curves || []).filter(c=>c.role==='data').reduce((n,c)=>n+c.points,0),Number(process.env.TEST_EXPECT_OBSERVATIONS));
if(process.env.TEST_EXPECT_REFERENCES) expect('reference count',(done?.curves || []).filter(c=>c.role==='reference').length,Number(process.env.TEST_EXPECT_REFERENCES));
if(process.env.TEST_EXPECT_MARKERS) expect('circle marker count',(done?.code?.match(/ circle /g) || []).length,Number(process.env.TEST_EXPECT_MARKERS));
if(process.env.TEST_EXPECT_CONNECTION) expect('data connections',(done?.curves || []).filter(c=>c.role==='data').map(c=>c.connection),[process.env.TEST_EXPECT_CONNECTION]);
if(process.env.TEST_EXPECT_X_TICKS) expect('x-axis ticks',(done?.axisTicks || []).map(t=>t.value),process.env.TEST_EXPECT_X_TICKS.split(',').map(Number));
if(process.env.TEST_FORBID_CUBICS==='1') expect('no smoothed path',Boolean(done?.code?.includes('.. controls')),false);
const report = { ...done, code: undefined, events, testChecks,elapsedMs: Date.now() - started, sourceImage: path.basename(imagePath), realModel: 'deepseek-flash', route: '/api/ai/text2tikz' };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, ok: done?.ok, visual: done?.visual,testChecks, elapsedMs: report.elapsedMs, trace: done?.trace }));
if (!done?.ok || !done.visual?.pass || testChecks.some(c=>!c.pass)) process.exitCode = 1;
