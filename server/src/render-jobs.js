const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn,execFile,execFileSync}=require('node:child_process');
const math=require('../../js/artifacts/MathExperiment');
const failure=(code,status=400,message=code)=>Object.assign(new Error(message),{code,status});
function findDocker(){for(const dir of (process.env.PATH||'').split(path.delimiter)){const file=path.join(dir,process.platform==='win32'?'docker.exe':'docker');if(fs.existsSync(file))return file;}return null;}
class RenderJobs{
 constructor({root=path.resolve('data/render-jobs'),executor,dockerPath=findDocker(),image='manimcommunity/manim:v0.19.0',timeoutMs=180000,maxJobs=16}={}){
  this.root=path.resolve(root);this.dockerPath=dockerPath;this.image=image;this.timeoutMs=timeoutMs;this.maxJobs=maxJobs;this.jobs=new Map();this.operations=new Map();this.executor=executor||this.runDocker.bind(this);this.available=!!executor;this.backend=executor?'injected-test-executor':'manim-docker';this.queue=Promise.resolve();fs.mkdirSync(this.root,{recursive:true});
  if(!executor&&dockerPath){try{execFileSync(dockerPath,['info','--format','{{.ServerVersion}}'],{windowsHide:true,timeout:2500,stdio:['ignore','pipe','pipe']});this.image=execFileSync(dockerPath,['image','inspect','--format','{{.Id}}',image],{windowsHide:true,timeout:2500,stdio:['ignore','pipe','pipe']}).toString().trim();this.available=/^sha256:[a-f0-9]{64}$/.test(this.image);}catch(error){this.probeError={code:'RENDER_ISOLATION_UNAVAILABLE',message:error.message};}}
  for(const entry of fs.readdirSync(this.root,{withFileTypes:true})){if(!entry.isDirectory()||!/^[-a-f0-9]{36}$/.test(entry.name))continue;const dir=path.join(this.root,entry.name),file=path.join(dir,'job.json');if(!fs.existsSync(file))continue;const saved=JSON.parse(fs.readFileSync(file,'utf8'));if(saved.id!==entry.name||typeof saved.sessionId!=='string')throw failure('RENDER_STATE_INVALID',500);const job={...saved,dir,controller:new AbortController()};if(['queued','running'].includes(job.status)){job.status='failed';job.finishedAt=Date.now();job.error={code:'RENDER_INTERRUPTED',message:'渲染服务重启；原任务没有继续执行。'};}this.jobs.set(job.id,job);if(job.operationId)this.operations.set(job.sessionId+':'+job.operationId,job.id);this.save(job);}
 }
 capabilities(){return {available:this.available,backend:this.backend,image:this.image,templates:['linear-map'],code:this.available?null:'RENDER_ISOLATION_UNAVAILABLE',requires:'Docker engine and locally installed manimcommunity/manim:v0.19.0 (resolved to immutable image ID)',probeError:this.probeError||null};}
 create(raw,sessionId,operationId){
  if(!sessionId||typeof sessionId!=='string'||sessionId.length>128||!operationId||typeof operationId!=='string'||operationId.length>128)throw failure('RENDER_REFERENCE_REQUIRED');
  if(raw?.type!=='linear-map')throw failure('RENDER_TEMPLATE_UNSUPPORTED');const spec=math.normalize(raw),hash=crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex'),key=sessionId+':'+operationId;
  if(this.operations.has(key)){const old=this.jobs.get(this.operations.get(key));if(old.hash!==hash)throw failure('RENDER_OPERATION_CONFLICT',409);return this.public(old);}
  if(!this.available)throw failure('RENDER_ISOLATION_UNAVAILABLE',503,'隔离渲染不可用：需要 Docker engine 与锁定的 Manim 镜像。');
  if(this.jobs.size>=this.maxJobs)throw failure('RENDER_QUOTA_EXCEEDED',429);
  const id=crypto.randomUUID(),dir=path.join(this.root,id);fs.mkdirSync(dir);fs.copyFileSync(path.join(__dirname,'../render/linear_scene.py'),path.join(dir,'linear_scene.py'));fs.writeFileSync(path.join(dir,'spec.json'),JSON.stringify(spec));
  const job={id,sessionId,operationId,hash,spec,dir,status:'queued',createdAt:Date.now(),controller:new AbortController()};this.jobs.set(id,job);this.operations.set(key,id);this.save(job);
  this.queue=this.queue.then(()=>this.run(job)).catch(error=>process.stderr.write(JSON.stringify({event:'render_queue_failed',code:error.code,message:error.message})+'\n'));return this.public(job);
 }
 public(j){return {id:j.id,sessionId:j.sessionId,hash:j.hash,status:j.status,createdAt:j.createdAt,startedAt:j.startedAt,finishedAt:j.finishedAt,durationMs:j.finishedAt&&j.startedAt?j.finishedAt-j.startedAt:null,error:j.error||null,exitCode:j.exitCode??null,bytes:j.bytes||0};}
 save(job){const target=path.join(job.dir,'job.json');fs.writeFileSync(target+'.tmp',JSON.stringify({...this.public(job),operationId:job.operationId}));fs.renameSync(target+'.tmp',target);}
 get(id,sessionId){const j=this.jobs.get(id);if(!j||j.sessionId!==sessionId)throw failure('RENDER_JOB_NOT_FOUND',404);return j;}
 cancel(id,sessionId){const j=this.get(id,sessionId);if(['succeeded','failed','cancelled'].includes(j.status))return this.public(j);j.status='cancelled';j.controller.abort(failure('RENDER_CANCELLED',499));j.finishedAt=Date.now();this.save(j);return this.public(j);}
 result(id,sessionId){const j=this.get(id,sessionId);if(j.status!=='succeeded')throw failure('RENDER_NOT_READY',409);return {file:path.join(j.dir,'scene.mp4'),bytes:j.bytes};}
 async run(j){
  if(j.controller.signal.aborted)return;j.status='running';j.startedAt=Date.now();this.save(j);const timer=setTimeout(()=>j.controller.abort(failure('RENDER_TIMEOUT',504)),this.timeoutMs);
  try{const out=await this.executor(j,{signal:j.controller.signal});j.exitCode=out.exitCode??0;if(j.exitCode!==0)throw Object.assign(failure('RENDER_FAILED',500),{exitCode:j.exitCode});if(j.controller.signal.aborted)throw j.controller.signal.reason||failure('RENDER_CANCELLED');const file=path.join(j.dir,'scene.mp4');if(!fs.existsSync(file))throw failure('RENDER_OUTPUT_MISSING',500);const size=fs.statSync(file).size;if(size<32||size>24*1024*1024)throw failure('RENDER_OUTPUT_QUOTA',413);j.bytes=size;j.status='succeeded';}
  catch(error){j.status=error.code==='RENDER_CANCELLED'?'cancelled':'failed';j.exitCode=error.exitCode??null;j.error={code:error.code||'RENDER_FAILED',message:error.message,stderr:String(error.stderr||'').slice(-8000)};}
  finally{clearTimeout(timer);j.finishedAt=Date.now();this.save(j);}
 }
 runDocker(job,{signal}){
  return new Promise((resolve,reject)=>{
   const name='wenju-render-'+job.id;let stderr='',settled=false;
   const args=['run','--rm','--name',name,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','1536m','--cpus','2','--user','65534:65534','--tmpfs','/tmp:rw,nosuid,size=256m','-v',job.dir+':/work','-w','/work','--entrypoint','python',this.image,'-m','manim','-ql','--disable_caching','--media_dir','/work/media','-o','scene.mp4','linear_scene.py','LinearScene'];
   const proc=spawn(this.dockerPath,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
   const finish=(err,result)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);err?reject(err):resolve(result);};
   const abort=()=>{proc.kill();execFile(this.dockerPath,['rm','-f',name],{windowsHide:true,timeout:5000},error=>{if(error)process.stderr.write(JSON.stringify({event:'render_container_cleanup_failed',jobId:job.id,message:error.message})+'\n');});finish(failure(signal.reason?.code||'RENDER_CANCELLED',499));};
   signal.addEventListener('abort',abort,{once:true});proc.stderr.on('data',b=>stderr=(stderr+b.toString()).slice(-8000));proc.on('error',e=>finish(Object.assign(e,{code:'RENDER_RUNTIME_UNAVAILABLE'})));proc.on('exit',code=>{if(settled)return;if(code!==0)return finish(Object.assign(failure('RENDER_FAILED',500,stderr||'Manim container exited with '+code),{exitCode:code,stderr}));try{const file=path.join(job.dir,'media/videos/linear_scene/480p15/scene.mp4');if(!fs.existsSync(file))return finish(failure('RENDER_OUTPUT_MISSING',500));fs.copyFileSync(file,path.join(job.dir,'scene.mp4'));finish(null,{exitCode:code});}catch(error){finish(error);}});if(signal.aborted)abort();
  });
 }
}
module.exports={RenderJobs};
