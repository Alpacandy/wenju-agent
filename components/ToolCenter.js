/** Actual tool catalog and authenticated local host connection. */
(function(root){
  'use strict';
  const labels={evaluate_pedagogical_scaffold:['教学引导','查看当前环节与预测要求'],solve_linear_system:['方程组求解','计算解的类型、特解与通解'],query_knowledge_graph:['概念与学习记录','查询概念依赖与已核验进度'],math_experiment:['数学实验','打开、操作并回读数学画布'],inspect_workspace:['查看当前工作区','读取当前画面和实际参数'],render_interactive_artifact:['交互工件','创建网页演示或三维实体'],render_canvas_graphics:['坐标图形','绘制受控二维图元'],solve_matrix_kernel_sympy:['矩阵求解','计算秩、核空间与检验结果'],construct_counterexample_matrix:['构造反例','生成并验证矩阵反例'],drive_canvas_affine_transform:['空间变换','驱动坐标画板矩阵变换'],execute_code_sandbox:['代码运行','在受控环境运行代码'],manage_workspace_file:['工作区文件','读取、编辑授权目录中的文件'],play_manim_lesson:['已有视频微课','播放微课或查询已有任务；生成已关闭'],generate_visual_illustration:['概念插图','生成视觉插图']};
  class ToolCenter {
    showRenderJob(job,client,sessionId){
      const dialog=document.createElement('dialog');dialog.className='tool-center render-job';
      const title=document.createElement('h2');title.textContent='Manim 动画任务';const status=document.createElement('p'),video=document.createElement('video');video.controls=true;video.hidden=true;
      const cancel=document.createElement('button');cancel.textContent='取消渲染';const close=document.createElement('button');close.textContent='关闭';const download=document.createElement('a');download.textContent='下载 MP4';download.download='linear-transformation.mp4';download.hidden=true;
      dialog.append(title,status,video,download,cancel,close);document.body.append(dialog);dialog.showModal();let timer,url,closed=false;
      const clean=()=>{closed=true;clearTimeout(timer);if(url)URL.revokeObjectURL(url);dialog.remove();};close.onclick=()=>dialog.close();dialog.addEventListener('close',clean,{once:true});
      cancel.onclick=async()=>{const r=await client.execute({action:'cancel',job_id:job.id},{sessionId});if(r.status==='success')update(r.job);else status.textContent=r.code+': '+r.error;};
      const update=async j=>{if(closed)return;clearTimeout(timer);job=j;status.textContent=j.status+(j.error?' · '+j.error.code+': '+j.error.message:'');cancel.disabled=['succeeded','failed','cancelled'].includes(j.status);
        if(j.status==='succeeded'){if(url)return;try{url=await client.video(j.id,sessionId);if(closed){URL.revokeObjectURL(url);return;}video.src=url;video.hidden=false;download.href=url;download.hidden=false;}catch(error){status.textContent=error.message;}return;}
        if(!cancel.disabled)timer=setTimeout(async()=>{const r=await client.execute({action:'status',job_id:j.id},{sessionId});if(r.status==='success')update(r.job);else status.textContent=r.code+': '+r.error;},1500);
      };update(job);
    }
    constructor({getEngine}) {
      this.getEngine=getEngine;
      const trigger=document.createElement('button');trigger.type='button';trigger.id='btn-tool-center';trigger.className='btn-toolbox-toggle';trigger.textContent='工具';trigger.title='工具目录与本地工作区';
      document.querySelector('.console-header-bar .agent-status-actions')?.appendChild(trigger);this.trigger=trigger;
      const dialog=document.createElement('dialog');dialog.id='tool-center';dialog.className='tool-center';dialog.setAttribute('aria-labelledby','tool-center-title');
      dialog.innerHTML=`<header><div><h2 id="tool-center-title">工具与工作区</h2><p id="tool-center-summary"></p></div><button type="button" id="tool-center-close" aria-label="关闭工具目录">×</button></header>
        <nav aria-label="工具面板"><button type="button" data-tab="catalog" aria-pressed="true">Agent 工具</button><button type="button" data-tab="workspace" aria-pressed="false">本地工作区</button></nav>
        <section id="tool-center-catalog"><input id="tool-center-search" type="search" placeholder="搜索工具名称或用途" aria-label="搜索工具"><div id="tool-center-list"></div></section>
        <section id="tool-center-workspace" hidden><p>选择目录后，Agent 可在授权目录内读写文件。浏览器虚拟文件会明确标注。</p><div id="tool-center-files"></div>
          <details class="tool-host-settings"><summary>连接本地后端</summary><p>输入本地服务的地址和访问令牌。连接通过鉴权检查后重新加载，启用本地会话存储与文件接口。</p>
            <form id="tool-host-form"><label>服务地址<input id="tool-host-url" type="url" required placeholder="http://127.0.0.1:8790" autocomplete="off"></label>
              <label>访问令牌<input id="tool-host-token" type="password" required autocomplete="off"></label><label>写入确认令牌（按服务策略选填）<input id="tool-host-confirm" type="password" autocomplete="off"></label>
              <div class="tool-host-actions"><button type="submit" id="tool-host-connect">连接并重新加载</button><button type="button" id="tool-host-disconnect">断开并重新加载</button></div></form><output id="tool-host-status" role="status" aria-live="polite"></output></details></section>`;
      document.body.appendChild(dialog);this.dialog=dialog;
      trigger.onclick=()=>this.open();this.$('tool-center-close').onclick=()=>dialog.close();
      dialog.addEventListener('close',()=>{(this.returnFocus||trigger).focus();this.returnFocus=null;});
      dialog.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>this.setTab(button.dataset.tab));
      this.$('tool-center-search').oninput=()=>this.renderCatalog();
      this.$('tool-host-form').onsubmit=e=>{e.preventDefault();this.connect();};
      this.$('tool-host-disconnect').onclick=()=>this.reloadHost(null).catch(error=>this.hostError(error.message));
    }
    $(id){return this.dialog.querySelector('#'+id);}
    open(){
      const engine=this.getEngine();
      this.$('tool-center-summary').textContent=`${engine.mcpServer.listTools().length} 个已注册工具 · ${engine.modelSupportsTools(engine.config.model)?'当前模型启用工具调用':'当前模型未启用工具调用'}`;
      this.renderCatalog();
      if(!this.files&&engine.workspaceFileSkill&&window.LocalWorkspacePanel)this.files=new window.LocalWorkspacePanel({skill:engine.workspaceFileSkill}).mount(this.$('tool-center-files'));
      try{
        const cfg=JSON.parse(localStorage.getItem('wenju_host_config')||'{}');
        this.$('tool-host-url').value=cfg.baseUrl||'';this.$('tool-host-token').value=cfg.token||'';this.$('tool-host-confirm').value=cfg.confirmToken||'';
        const state=window.hostConnectionState;
        this.$('tool-host-status').textContent=state?.status==='connected'?'已连接本地后端：'+cfg.baseUrl:state?.status==='checking'?'正在核验本地后端…':state?.status==='error'?`本地后端不可用（${state.code}）：${state.message}。当前使用浏览器存储。`:cfg.baseUrl?'已配置地址，尚未核验连接：'+cfg.baseUrl:'尚未连接本地后端';
        this.$('tool-host-status').dataset.state=state?.status==='error'?'error':'ready';
      }catch(error){this.hostError('本地配置读取失败：'+error.message);}
      this.dialog.showModal();this.$('tool-center-search').focus();
    }
    setTab(tab){
      this.$('tool-center-catalog').hidden=tab!=='catalog';this.$('tool-center-workspace').hidden=tab!=='workspace';
      this.dialog.querySelectorAll('[data-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.tab===tab)));
      if(tab==='workspace')this.files?.refresh().catch(error=>this.hostError(error.message));
    }
    renderCatalog(){
      const engine=this.getEngine(),query=this.$('tool-center-search').value.trim().toLowerCase(),list=this.$('tool-center-list'),metrics=engine.mcpServer.getMetrics();list.replaceChildren();
      const tools=engine.mcpServer.listTools().filter(tool=>(tool.name+' '+tool.description+' '+(labels[tool.name]||[]).join(' ')).toLowerCase().includes(query));
      for(const tool of tools){
        const row=document.createElement('details');row.className='tool-catalog-item';row.dataset.tool=tool.name;
        const summary=document.createElement('summary'),name=document.createElement('strong'),description=document.createElement('span');name.textContent=labels[tool.name]?.[0]||tool.name;description.textContent=labels[tool.name]?.[1]||tool.description||'未提供说明';summary.append(name,description);row.appendChild(summary);
        const stats=document.createElement('p'),metric=metrics[tool.name];stats.className='tool-call-metrics';stats.textContent=metric?`调用 ${metric.calls} 次 · 错误 ${metric.errors||0} 次`:'本次运行尚未调用';
        const schema=document.createElement('pre');schema.textContent=JSON.stringify(tool.parameters||tool.inputSchema||{},null,2);
        const insert=document.createElement('button');insert.type='button';insert.textContent='用于对话';insert.onclick=()=>{
          const textarea=window.promptInputDock?.textarea||document.getElementById('dock-textarea');
          if(!textarea)return;
          textarea.value+=(textarea.value?'\n':'')+`请使用 ${tool.name} 工具：`;
          textarea.dispatchEvent(new Event('input',{bubbles:true}));this.returnFocus=textarea;this.dialog.close();textarea.focus();
        };
        const technical=document.createElement('details'),heading=document.createElement('summary');heading.textContent='接口参数 · '+tool.name;technical.append(heading,schema);row.append(stats,insert,technical);list.appendChild(row);
      }
      if(!tools.length){const empty=document.createElement('p');empty.textContent='没有匹配的已注册工具';list.appendChild(empty);}
      for(const issue of engine.getSkillLoadErrors?.()||[]){const warning=document.createElement('p');warning.className='tool-load-error';warning.textContent='工具加载失败：'+JSON.stringify(issue);list.appendChild(warning);}
    }
    hostError(message){const el=this.$('tool-host-status');el.textContent=message;el.dataset.state='error';}
    requestApproval({name,args,signal}){
      if(signal?.aborted||this.approvalPending)return Promise.resolve(false);
      this.approvalPending=true;
      return new Promise(resolve=>{
        const dialog=document.createElement('dialog');dialog.className='tool-center tool-approval';dialog.setAttribute('aria-labelledby','tool-approval-title');
        const header=document.createElement('header'),title=document.createElement('h2');title.id='tool-approval-title';title.textContent='确认工具操作';const stop=document.createElement('button');stop.type='button';stop.id='tool-approval-stop';stop.textContent='停止本轮';header.append(title,stop);
        const description=document.createElement('p');description.textContent=name==='render_interactive_artifact'?(args.solid_type==='cube'?'生成可旋转的正方体工件。':args.solid_type==='sphere'?'生成可旋转的球体工件。':'创建或更新交互工件。'):name==='manage_workspace_file'?`工作区文件操作：${args.action} · ${args.filepath||'选择目录'}`:`${name} 将修改工作区、生成工件或执行代码。`;
        const preview=document.createElement('pre');preview.className='tool-approval-preview';preview.textContent=JSON.stringify(args,null,2).slice(0,5000);
        const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='查看工具参数';details.append(summary,preview);
        const actions=document.createElement('div');actions.className='tool-host-actions';const reject=document.createElement('button'),approve=document.createElement('button');reject.type=approve.type='button';reject.id='tool-approval-reject';approve.id='tool-approval-approve';reject.textContent='取消操作';approve.textContent='执行一次';actions.append(reject,approve);const body=document.createElement('section');body.append(description,details,actions);dialog.append(header,body);document.body.appendChild(dialog);
        const previous=document.activeElement;let settled=false;
        const finish=approved=>{if(settled)return;settled=true;signal?.removeEventListener('abort',aborted);dialog.close();dialog.remove();this.approvalPending=false;previous?.focus?.();resolve(approved);};
        const aborted=()=>finish(false);stop.onclick=()=>{this.getEngine()?.abort?.();finish(false);};reject.onclick=()=>finish(false);approve.onclick=()=>finish(true);dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});signal?.addEventListener('abort',aborted,{once:true});dialog.showModal();reject.focus();
        if(signal?.aborted)finish(false);
      });
    }
    canReload(){
      if(window.artifactStageDeck?._dirty){this.hostError('工件源码尚未保存，请保存或撤销修改后连接。');return false;}
      if(this.files?.dirty){this.hostError('文件内容尚未保存，请写入文件后连接。');return false;}
      return true;
    }
    async reloadHost(config){
      if(this._reloading||!this.canReload())return false;
      this._reloading=true;
      try{
        window.getAgentEngine?.()?.abort?.();
        if(window.workspaceSessions?.capture()===false)throw Error('SESSION_SAVE_FAILED：会话未保存，已取消重新加载。');
        const saved=await window.sessionHistoryManager?.flush?.();
        if(saved?.ok===false && config!==null)throw Error(`${saved.code}：${saved.message}`);
        if(!this.canReload())return false;
        if(config===null)localStorage.removeItem('wenju_host_config');
        else localStorage.setItem('wenju_host_config',JSON.stringify(config));
        location.reload();return true;
      }finally{this._reloading=false;}
    }
    async connect(){
      if(!this.canReload())return;
      const button=this.$('tool-host-connect');button.disabled=true;
      try{
        const base=new URL(this.$('tool-host-url').value.trim());
        if(!['http:','https:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error('服务地址必须是本机 HTTP(S) 根地址');
        const cfg={baseUrl:base.origin,token:this.$('tool-host-token').value.trim(),confirmToken:this.$('tool-host-confirm').value.trim()||null};
        if(!cfg.token)throw Error('请输入访问令牌');
        this.$('tool-host-status').textContent='正在核验本地服务…';
        this.$('tool-host-status').dataset.state='checking';
        const response=await fetch(cfg.baseUrl+'/v1/capabilities',{headers:{Authorization:'Bearer '+cfg.token},signal:AbortSignal.timeout(5000)});
        const data=await response.json();
        if(!response.ok||!data.ok)throw Error(`${data.code||response.status}：${data.message||'连接失败'}`);
        if(data.service!=='teachagent-local'||data.version!==1||!data.storage?.available)throw Error('服务未提供兼容的本地存储接口');
        if(!data.workspace?.available)throw Error(`${data.workspace?.code||'WORKSPACE_UNAVAILABLE'}：工作区不可用`);
        await this.reloadHost(cfg);
      }catch(error){this.hostError(error instanceof TypeError?'连接失败：核对服务地址、服务运行状态与允许的页面来源。'+error.message:error.message);}
      finally{button.disabled=false;}
    }
  }
  root.ToolCenter=ToolCenter;
})(window);
