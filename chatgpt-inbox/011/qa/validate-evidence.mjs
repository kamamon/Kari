// Read-only evidence and integrity checks for request 011.
// Node >=22. Run from the Kari repository root:
//   node chatgpt-inbox/011/qa/validate-evidence.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const wd=process.cwd(), dir=path.join(wd,'chatgpt-inbox/011');
const fail=(why)=>{throw new Error(why)};
const text=(p)=>fs.readFileSync(p,'utf8');
const json=(p)=>JSON.parse(text(p));
const names=fs.readdirSync(dir).filter(n=>n.endsWith('.json')&&n!=='INDEX.json'&&n!=='2G_MISSING_ACTIONS.json').sort();
const idx=json(path.join(dir,'INDEX.json')), extra=json(path.join(dir,'2G_MISSING_ACTIONS.json'));
if(names.length!==130||idx.records.length!==130||idx.count!==130)fail('main 130 action/renderer observations mismatch');
if(extra.entries.length!==27)fail('expected 27 proposed new actions');
const ids=new Set(), recorded=new Set(), problems=[];
const hashBlob=(s)=>{const b=Buffer.from(s,'utf8');return crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex')};
for(const f of names){
 const raw=text(path.join(dir,f)), x=JSON.parse(raw), ks=x.keys?.map(k=>k.key);
 if(!x.kariActionId||ids.has(x.kariActionId))fail('missing/duplicate id '+f);
 ids.add(x.kariActionId);
 if(f!==x.kariActionId.replaceAll('/','_').replaceAll('#','.')+'.json')fail('mismatch filename '+f);
 for(const k of ['K0','K1','K3','K4'])if(!ks?.includes(k))fail('missing '+k+' '+f);
 if(!ks.some(k=>k==='K2'||/^K2[a-z]$/.test(k)))fail('missing contact K2 '+f);
 if(!x.source?.length||!x.unknowns?.length||!x.evidenceStatus)fail('missing source or limitations '+f);
 if(x.keys.some(k=>!k.support||!k.feet?.L||!k.feet?.R||!k.pelvis||!k.chest||!k.weapon||!k.root||!k.time))fail('missing pose entry '+f);
 if(x.keys.some(k=>k.time!=='未測定'))problems.push(f+': non-unmeasured time; review source footage');
 if(x.controlEvidence?.frameBasedObservation)problems.push(f+': frameBasedObservation flag must be false until footage reviewed');
 const record=idx.records.find(y=>y.path===f);
 if(!record||record.blobSha!==hashBlob(raw))fail('INDEX blob SHA mismatch '+f);
 recorded.add(f);
}
for(const y of idx.records)if(!recorded.has(y.path))fail('index includes nonexistent '+y.path);
for(const a of extra.entries){
 if(!a.proposedActionId||ids.has(a.proposedActionId))fail('proposed ID collides with current '+a.proposedActionId);
 if(!a.keys||a.keys.map(k=>k.key).join(',')!=='K0,K1,K2,K3,K4')fail('invalid proposal keys '+a.proposedActionId);
 if(!a.source?.[0]?.url||!a.technicalNotes||a.verifiedVideoFrames!==false)fail('proposal evidence incomplete '+a.proposedActionId);
}
if(problems.length)fail('Evidence claim needs review: '+problems.join('; '));
console.log(JSON.stringify({status:'STRUCTURE_AND_EVIDENCE_OK',existingObservations:names.length,proposedMissingActions:extra.entries.length,indexIntegrity:'ok',videoMotionFramesVerified:false,warning:'NOT a gameplay, motion-fidelity, or visual-accuracy certification'},null,2));
