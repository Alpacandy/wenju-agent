/**
 * Local workspace controls.
 *
 * This component is intentionally independent from the teaching surface. It
 * only exposes directory authorization, file listing, write-back, detach and
 * the LocalWorkspace audit stream. Mount it where the host shell chooses.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LocalWorkspacePanel = api.LocalWorkspacePanel;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  function element(documentRef, tag, text) {
    const node = documentRef.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  class LocalWorkspacePanel {
    constructor(options = {}) {
      this.skill = options.skill;
      this.document = options.document || (typeof document !== 'undefined' ? document : null);
      this.container = null;
      this.unsubscribe = null;
      this.nodes = {};
      if (!this.skill || typeof this.skill.execute !== 'function') throw new TypeError('skill with execute() is required');
      if (!this.document) throw new Error('a DOM document is required');
    }

    mount(container) {
      if (!container || typeof container.appendChild !== 'function') throw new TypeError('container must be a DOM element');
      this.container = container;
      const d = this.document;
      const panel = element(d, 'section');
      panel.className = 'local-workspace-panel';
      panel.setAttribute('aria-label', '文件工作区');
      const title = element(d, 'h2', '文件工作区');
      title.className = 'local-workspace-title';
      panel.appendChild(title);

      const actions = element(d, 'div');
      actions.className = 'local-workspace-actions';
      const authorize = element(d, 'button', '选择本地目录');
      authorize.type = 'button';
      const revoke = element(d, 'button', '撤销目录授权');
      revoke.type = 'button';
      const refresh = element(d, 'button', '刷新文件');
      refresh.type = 'button';
      actions.append(authorize, revoke, refresh);
      panel.appendChild(actions);

      const path = element(d, 'input');
      path.type = 'text';
      path.placeholder = 'relative/path.js';
      path.setAttribute('aria-label', '相对文件路径');
      const content = element(d, 'textarea');
      content.rows = 6;
      content.placeholder = '文件内容';
      content.setAttribute('aria-label', '文件内容');
      const write = element(d, 'button', '写入文件');
      write.type = 'button';
      const discard = element(d, 'button', '撤销编辑');discard.type='button';
      const status = element(d, 'output');
      status.className = 'local-workspace-status';
      status.setAttribute('role', 'status');
      const files = element(d, 'ul');
      files.className = 'local-workspace-files';
      const audit = element(d, 'pre');
      audit.className = 'local-workspace-audit';
      audit.setAttribute('aria-label', 'Workspace audit events');
      panel.append(path, content, write, discard, status, files, audit);
      container.appendChild(panel);
      this.nodes = { panel, authorize, revoke, refresh, path, content, write, status, files, audit };

      authorize.addEventListener('click', () => this._authorize());
      revoke.addEventListener('click', () => this._revoke());
      refresh.addEventListener('click', () => this.refresh());
      write.addEventListener('click', () => this._write());
      this.dirty=false;this.editRevision=0;this.saved={path:'',content:''};
      const track=()=>{this.editRevision++;this.dirty=path.value!==this.saved.path||content.value!==this.saved.content;};path.addEventListener('input',track);content.addEventListener('input',track);
      discard.onclick=()=>{path.value=this.saved.path;content.value=this.saved.content;this.dirty=false;this._setStatus('已撤销文件编辑');};
      this.unsubscribe = typeof this.skill.subscribe === 'function'
        ? this.skill.subscribe((event) => this._onSkillEvent(event)) : null;
      this._setStatus(this._modeLabel());
      this._renderAudit();
      return this;
    }

    _mode() { return typeof this.skill.getMode === 'function' ? this.skill.getMode() : 'virtual'; }
    _modeLabel(){return {local:'已授权本地目录',host:'本地后端工作区',virtual:'浏览器虚拟文件；选择目录后启用本地文件'}[this._mode()]||'工作区状态未知';}

    async _authorize() {
      if(this.dirty){this._setStatus('请先写入或撤销文件编辑',true);return;}
      try {
        if (typeof this.skill.authorizeLocal !== 'function') throw new Error('skill does not expose local authorization');
        await this.skill.authorizeLocal();
        this._setStatus('已授权本地目录');
        await this.refresh();
      } catch (error) { this._setStatus(`目录授权失败：${error.message}`, true); }
    }

    _revoke() {
      if(this.dirty){this._setStatus('请先写入或撤销文件编辑',true);return;}
      try {
        if (typeof this.skill.revokeLocal !== 'function') throw new Error('skill does not expose local revoke');
        this.skill.revokeLocal();
        this.nodes.files.replaceChildren();
        this._setStatus(this._modeLabel());
      } catch (error) { this._setStatus(`撤销授权失败：${error.message}`, true); }
    }

    async refresh() {
      const result = await this.skill.execute({ action: 'list' });
      if (result.status !== 'success') {
        this._setStatus(result.error || 'Unable to list workspace files.', true);
        this._renderAudit();
        return result;
      }
      this.nodes.files.replaceChildren();
      for (const file of result.files || []) {
        const item = element(this.document, 'li');
        const open=element(this.document,'button',`${file.path} (${file.size} bytes)`);open.type='button';item.appendChild(open);
        item.dataset.path = file.path;
        open.addEventListener('click', () => this._read(file.path));
        this.nodes.files.appendChild(item);
      }
      this._setStatus(`${this._modeLabel()} · ${result.totalFiles || 0} 个文件`);
      this._renderAudit();
      return result;
    }

    async _read(path) {
      if(this.dirty){this._setStatus('请先写入或撤销文件编辑',true);return;}
      const revision=this.editRevision,sequence=this.readSequence=(this.readSequence||0)+1;
      const result = await this.skill.execute({ action: 'read', filepath: path });
      if(sequence!==this.readSequence)return result;
      if(revision!==this.editRevision){this._setStatus('读取期间内容已编辑，保留当前编辑',true);return result;}
      if (result.status === 'success') {
        this.nodes.path.value = result.filepath || path;
        this.nodes.content.value = result.content || '';
        this.saved={path:this.nodes.path.value,content:this.nodes.content.value};this.dirty=false;
        this._setStatus(`已读取 ${path}`);
      } else this._setStatus(result.error || `Unable to read ${path}.`, true);
      this._renderAudit();
      return result;
    }

    async _write() {
      if(this.writing)return {status:'error',error:'WRITE_IN_PROGRESS'};
      this.writing=true;this.nodes.write.disabled=true;
      try{
      const written={path:this.nodes.path.value,content:this.nodes.content.value};
      const result = await this.skill.execute({ action: 'write', filepath: written.path, content: written.content });
      if (result.status === 'success') {
        this.saved=written;this.dirty=this.nodes.path.value!==written.path||this.nodes.content.value!==written.content;
        await this.refresh();
        this._setStatus(`已写入 ${result.filepath || written.path} · ${this._modeLabel()}${this.dirty?' · 还有未保存编辑':''}`);
      } else this._setStatus(result.error || '写入失败', true);
      this._renderAudit();
      return result;
      }catch(error){
        if(typeof recordIssue==='function')recordIssue('LocalWorkspacePanel','write',error);
        this._setStatus('文件写入异常：'+error.message,true);return {status:'error',error:error.message};
      }finally{this.writing=false;this.nodes.write.disabled=false;}
    }

    _onSkillEvent(event) {
      if (event && event.type === 'audit') this._renderAudit();
      if (event && event.type === 'mode') this._setStatus(this._modeLabel());
    }

    _renderAudit() {
      if (!this.nodes.audit) return;
      const events = this.skill.localWorkspace && typeof this.skill.localWorkspace.getAuditEvents === 'function'
        ? this.skill.localWorkspace.getAuditEvents() : [];
      this.nodes.audit.textContent = events.slice(-20).map((event) => JSON.stringify(event)).join('\n');
    }

    _setStatus(message, isError = false) {
      if (!this.nodes.status) return;
      this.nodes.status.textContent = message;
      this.nodes.status.dataset.state = isError ? 'error' : 'ok';
    }

    destroy() {
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = null;
      if (this.nodes.panel && this.nodes.panel.parentNode) this.nodes.panel.parentNode.removeChild(this.nodes.panel);
      this.container = null;
      this.nodes = {};
    }
  }

  return { LocalWorkspacePanel };
});

