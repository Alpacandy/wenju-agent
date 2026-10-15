(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./HostFileClient'):root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ManimRenderClient=api.ManimRenderClient;})(typeof globalThis!=='undefined'?globalThis:this,function({HostFileClient}){
 class ManimRenderClient{
  constructor(options={}){this.http=new HostFileClient(options);}
  async execute(args,{sessionId,signal,operationId}={}){
   const action=args.action,base='/v1/render/jobs',query='?sessionId='+encodeURIComponent(sessionId||'');
   if(action!=='capabilities'&&!sessionId)return {status:'error',code:'RENDER_REFERENCE_REQUIRED'};
   const method=action==='render'?'POST':action==='cancel'?'DELETE':'GET';
   const endpoint=action==='capabilities'?'/v1/render/capabilities':action==='render'?base:base+'/'+encodeURIComponent(args.job_id||'')+query;
   const response=await this.http._call(method,endpoint,{signal,body:action==='render'?{sessionId,operationId:args.operation_id||operationId,spec:args.spec}:undefined});
   if(response.status!=='success')return response;
   if(action==='capabilities')return {status:'success',capabilities:response.data};
   const job=response.data.job;if(!job||typeof job.id!=='string'||!['queued','running','succeeded','failed','cancelled'].includes(job.status))return {status:'error',code:'RENDER_RESPONSE_INVALID'};
   return {status:'success',job};
  }
  async video(jobId,sessionId){
   const ep=this.http._endpoint();if(!ep)throw new Error('HOST_FILE_UNAVAILABLE');
   const r=await this.http.fetchImpl(ep.baseUrl+'/v1/render/jobs/'+encodeURIComponent(jobId)+'/result?sessionId='+encodeURIComponent(sessionId),{headers:{authorization:'Bearer '+ep.token},signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw new Error('RENDER_VIDEO_HTTP_'+r.status);const bytes=await r.arrayBuffer();if(bytes.byteLength>24*1024*1024)throw new Error('RENDER_OUTPUT_QUOTA');return URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));
  }
 }
 return {ManimRenderClient};
});
