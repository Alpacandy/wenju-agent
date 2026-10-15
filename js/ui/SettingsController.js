/** SettingsController: browser UI responsibility with injected application dependencies. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.SettingsController = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSettingsController({ window, document, localStorage, getAgentEngine, promptInputDock }) {
  // 13. API Key 与推理模型设置模态框
  const modal = document.getElementById('api-settings-modal');
  const btnOpenModal = document.getElementById('btn-open-api-config');
  const btnOpenModalNav = document.getElementById('btn-open-api-config-nav');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnSaveCfg = document.getElementById('btn-save-cfg');
  const btnClearApiKey = document.getElementById('btn-clear-apikey');
  const btnTestConn = document.getElementById('btn-test-connection');
  const testConnBanner = document.getElementById('test-connection-result');
  const cfgProvider = document.getElementById('cfg-provider');
  const cfgModelSelect = document.getElementById('cfg-model-select');
  // B-R1-2: 模型下拉选项只从 ModelCatalog 生成（两组：Agent 主模式 / 对照·闲聊），ASR 与生图不进对话下拉
  if (cfgModelSelect) {
    if (window.ModelCatalog && typeof window.ModelCatalog.renderModelSelectOptionsHtml === 'function') {
      cfgModelSelect.innerHTML=window.ModelCatalog.renderModelSelectOptionsHtml();
    } else {
      console.error('[app] MODEL_CATALOG_MISSING: ModelCatalog 未加载，模型下拉无法生成');
    }
  }
  const cfgPresetModelWrap = document.getElementById('cfg-preset-model-wrap');
  const cfgCustomModelWrap = document.getElementById('cfg-custom-model-wrap');
  const cfgApiKey = document.getElementById('cfg-apikey');
  const cfgModel = document.getElementById('cfg-model');
  const cfgBaseUrl = document.getElementById('cfg-baseurl');
  const cfgToolsMode = document.getElementById('cfg-tools-mode');
  const cfgToolsWrap = document.getElementById('cfg-tools-wrap');
  const modelLabel = document.getElementById('agent-current-model-label');
  const modelLabelNav = document.getElementById('agent-nav-model-label');
  const managedKeyBanner = document.getElementById('cfg-managed-key-banner');
  const customCredsWrap = document.getElementById('cfg-custom-credentials-wrap');
  const cfgDisclaimerTitle = document.getElementById('cfg-disclaimer-title');
  const cfgDisclaimerText = document.getElementById('cfg-disclaimer-text');
  let probeRevision=0;
  function invalidateProbe() {
    probeRevision++;
    if(testConnBanner){testConnBanner.className='test-connection-banner hidden';testConnBanner.textContent='';}
  }
  for(const field of [cfgProvider,cfgApiKey,cfgModel,cfgBaseUrl,cfgModelSelect,cfgToolsMode]) {
    field?.addEventListener('input',invalidateProbe);field?.addEventListener('change',invalidateProbe);
  }

  const PROVIDER_CONFIGS_STORAGE_KEY = 'teachagent_provider_configs';
  function getCachedProviderConfigs() {
    try {
      const raw = localStorage.getItem(PROVIDER_CONFIGS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }
  function saveCachedProviderConfig(provider, config) {
    try {
      const all = getCachedProviderConfigs();
      all[provider] = Object.assign({}, all[provider] || {}, config);
      localStorage.setItem(PROVIDER_CONFIGS_STORAGE_KEY, JSON.stringify(all));
    } catch (_) { if (typeof recordIssue === 'function') recordIssue('SettingsController', 'saveCachedProviderConfig', _); }
  }

  function syncProviderCredentialsUI(provider) {
    if (cfgToolsWrap) cfgToolsWrap.hidden = false;
    document.querySelectorAll('.cfg-quick-chip').forEach(chip=>{chip.hidden=provider==='openai_official'||(provider==='deepseek_official'&&!chip.dataset.model.startsWith('deepseek-'));});
    if (managedKeyBanner) { managedKeyBanner.style.display='none';managedKeyBanner.textContent=''; }
    if (customCredsWrap) customCredsWrap.style.display = 'block';

    // 动态同步模型输入区域：自定义端点直开自定义输入框；其余默认展示预设下拉
    if (provider === 'custom') {
      if (cfgPresetModelWrap) cfgPresetModelWrap.style.display = 'none';
      if (cfgCustomModelWrap) cfgCustomModelWrap.style.display = 'block';
    } else {
      if (cfgPresetModelWrap) cfgPresetModelWrap.style.display = 'block';
      const isCustomInput = (cfgModelSelect && cfgModelSelect.value === 'custom_input');
      if (cfgCustomModelWrap) cfgCustomModelWrap.style.display = isCustomInput ? 'block' : 'none';
    }

    // 动态同步 Provider 专属说明卡片与输入提示
    if (cfgApiKey) {
      if (provider === 'minimax') {
        cfgApiKey.placeholder = '留空使用系统内置托管 Key，或填写自定义 Key 覆盖';
      } else if (['deepseek_official', 'openai_official'].includes(provider)) {
        cfgApiKey.placeholder = '请输入您的 API Key (必填 · 端侧直连)';
      } else {
        cfgApiKey.placeholder = 'sk-... (可选，本地模型可留空)';
      }
    }
    if (cfgDisclaimerTitle && cfgDisclaimerText) {
      if (provider === 'minimax') {
        cfgDisclaimerTitle.textContent = '✦ MiniMax 深度推理旗舰 (系统内置 · 开箱即用)';
        cfgDisclaimerText.textContent = '平台内置旗舰 MiniMax-M3 系列模型，开箱即用（无需配置即可对话并调度画板）。亦支持在此填写私有 Key 覆盖默认配额。';
      } else if (provider === 'deepseek_official') {
        cfgDisclaimerTitle.textContent = '✦ DeepSeek 官方/兼容 API (端侧直连 · 零密钥收集)';
        cfgDisclaimerText.textContent = '使用个人自备的 DeepSeek API Key（直连官方或中转端点，密钥仅存本机 localStorage）。支持 deepseek-chat、deepseek-reasoner 或任意兼容模型。';
      } else if (provider === 'openai_official') {
        cfgDisclaimerTitle.textContent = '✦ OpenAI 官方/兼容 API (端侧直连 · 零密钥收集)';
        cfgDisclaimerText.textContent = '使用个人自备的 OpenAI 或兼容服务商 API Key。点击“读取账户模型”获取清单，或手动输入任意模型 ID。';
      } else if (provider === 'custom') {
        cfgDisclaimerTitle.textContent = '✦ 自定义 OpenAI-Compatible / 第三方聚合端点';
        cfgDisclaimerText.textContent = '自由接入 OneAPI、NewAPI、各类第三方中转站或本地 Ollama/vLLM。任意 BaseURL 与任意模型名称均直接放行，无静态目录限制。';
      }
    }
  }

  function updateAgentModeUI() {
    const engine = getAgentEngine();
    const hasKey = engine && engine.hasValidApiKey();
    const navDot = document.querySelector('#btn-open-api-config-nav .agent-status-dot');
    const studioDot = document.querySelector('#btn-open-api-config .agent-status-dot');
    const modalIndicator = document.getElementById('modal-current-mode-indicator');

    if (hasKey) {
      const modelName = engine.config.model || 'MiniMax-M3.1-Flash-Preview';
      let displayName = modelName;
      if (promptInputDock && typeof promptInputDock.getPresetModels === 'function') {
        const hit = promptInputDock.getPresetModels().find(m => m.id === modelName);
        if (hit) displayName = hit.name;
        else displayName = modelName.split('/').pop();
      } else if (window.promptInputDock && typeof window.promptInputDock.getPresetModels === 'function') {
        const hit = window.promptInputDock.getPresetModels().find(m => m.id === modelName);
        if (hit) displayName = hit.name;
        else displayName = modelName.split('/').pop();
      } else if (window.PromptInputDock && window.PromptInputDock.prototype && typeof window.PromptInputDock.prototype.getPresetModels === 'function') {
        const hit = window.PromptInputDock.prototype.getPresetModels().find(m => m.id === modelName);
        if (hit) displayName = hit.name;
        else displayName = modelName.split('/').pop();
      }
      const isMinimax = /minimax/i.test(modelName) || engine?.config?.provider === 'minimax';
      const labelPrefix = isMinimax ? '已就绪 (内置旗舰)' : '已配置';
      if (modelLabel) modelLabel.textContent = `${labelPrefix}: ${displayName}`;
      if (modelLabelNav) modelLabelNav.textContent = `${labelPrefix}: ${displayName}`;
      if (navDot) navDot.className = 'agent-status-dot active-cloud';
      if (studioDot) studioDot.className = 'agent-status-dot active-cloud';
      if (modalIndicator) {
        modalIndicator.className = 'agent-mode-banner cloud';
        modalIndicator.textContent = isMinimax
          ? `系统内置旗舰：${displayName} · 开箱即用（支持在下方配置私有 Key 覆盖）`
          : `已保存配置：${displayName} · 下方可修改并测试新参数，测试结果仅对应本次参数`;
      }
    } else {
      if (modelLabel) modelLabel.textContent = `✖ Agent 不可用 · 未配置 API Key`;
      if (modelLabelNav) modelLabelNav.textContent = `✖ 未配置 Key`;
      if (navDot) navDot.className = 'agent-status-dot active-fallback';
      if (studioDot) studioDot.className = 'agent-status-dot active-fallback';
      if (modalIndicator) {
        modalIndicator.className = 'agent-mode-banner unavailable';
        modalIndicator.innerHTML = `<span>✖ 当前状态：未配置 API Key，Agent 不可用（不提供本地替代回答）</span>`;
      }
    }
  }

  function openApiModal() {
    const engine = getAgentEngine();
    if (engine && engine.config) {
      const cfg = engine.config;
      const curProvider = cfg.provider || 'minimax';
      if (cfgProvider) cfgProvider.value = curProvider;
      syncProviderCredentialsUI(curProvider);

      if (cfgApiKey) cfgApiKey.value = cfg.apiKey || '';
      if (cfgToolsMode) cfgToolsMode.value = cfg.customToolsMode || 'auto';
      if (cfgBaseUrl) cfgBaseUrl.value = cfg.baseUrl || (curProvider === 'minimax' ? 'https://api.botmeow.top/v1' : (curProvider === 'custom' ? 'http://localhost:11434/v1' : 'https://api.botmeow.top/v1'));

      const currentModel = cfg.model || (curProvider === 'custom' ? 'deepseek-r1' : 'MiniMax-M3.1-Flash-Preview');
      if (cfgModel) cfgModel.value = currentModel;

      if (cfgModelSelect) {
        if (window.ModelCatalog && typeof window.ModelCatalog.renderModelSelectOptionsHtml === 'function') {
          cfgModelSelect.innerHTML = window.ModelCatalog.renderModelSelectOptionsHtml(currentModel,curProvider);
        }
        let matched = false;
        for (let opt of cfgModelSelect.options) {
          if (opt.value === currentModel) {
            cfgModelSelect.value = currentModel;
            matched = true;
            break;
          }
        }
        if (curProvider === 'custom') {
          cfgModelSelect.value = 'custom_input';
          if (cfgCustomModelWrap) cfgCustomModelWrap.style.display = 'block';
          if (cfgPresetModelWrap) cfgPresetModelWrap.style.display = 'none';
        } else if (!matched) {
          cfgModelSelect.value = 'custom_input';
          if (cfgCustomModelWrap) cfgCustomModelWrap.style.display = 'block';
          if (cfgPresetModelWrap) cfgPresetModelWrap.style.display = 'block';
        } else {
          if (cfgCustomModelWrap) cfgCustomModelWrap.style.display = 'none';
          if (cfgPresetModelWrap) cfgPresetModelWrap.style.display = 'block';
        }
      }
    } else {
      syncProviderCredentialsUI('minimax');
    }
    if (testConnBanner) {
      testConnBanner.className = 'test-connection-banner hidden';
      testConnBanner.textContent = '';
    }
    updateAgentModeUI();
    if (modal) modal.classList.remove('hidden');
  }

  // 挂载至全局，供输入坞及外部组件随时调用
  window.openApiModal = openApiModal;
  window.updateAgentModeUI = updateAgentModeUI;

  // 服务提供方切换
  if (cfgProvider) {
    cfgProvider.addEventListener('change', () => {
      const val = cfgProvider.value;
      const cached = getCachedProviderConfigs()[val] || {};
      if(cfgToolsMode)cfgToolsMode.value=cached.customToolsMode||'auto';
      if(cfgModelSelect)cfgModelSelect.innerHTML=window.ModelCatalog.renderModelSelectOptionsHtml(cached.model||(val==='deepseek_official'?'deepseek-flash':undefined),val);
      syncProviderCredentialsUI(val);
      if (val === 'minimax') {
        if (cfgBaseUrl) cfgBaseUrl.value = cached.baseUrl || 'https://api.botmeow.top/v1';
        if (cfgApiKey) cfgApiKey.value = cached.apiKey || ''; // P0-1：不注入内置凭证
        const m = cached.model || 'MiniMax-M3.1-Flash-Preview';
        if (cfgModel) cfgModel.value = m;
        if (cfgModelSelect) cfgModelSelect.value = m;

      } else if (val === 'deepseek_official') {
        if (cfgBaseUrl) cfgBaseUrl.value = cached.baseUrl || 'https://api.deepseek.com';
        if (cfgApiKey) cfgApiKey.value = (cached.apiKey && !cached.apiKey.startsWith('sk-zrev') && !cached.apiKey.startsWith('sk-bHH')) ? cached.apiKey : '';
        const m = window.ModelCatalog.canonicalModelId(cached.model||'deepseek-flash',val);
        if (cfgModel) cfgModel.value = m;
        if (cfgModelSelect) cfgModelSelect.value = m;
        if(cfgCustomModelWrap)cfgCustomModelWrap.style.display=cfgModelSelect?.value===m?'none':'block';
      } else if (val === 'openai_official') {
        if (cfgBaseUrl) cfgBaseUrl.value = cached.baseUrl || 'https://api.openai.com/v1';
        if (cfgApiKey) cfgApiKey.value = (cached.apiKey && !cached.apiKey.startsWith('sk-zrev') && !cached.apiKey.startsWith('sk-bHH')) ? cached.apiKey : '';
        const m = cached.model || '';
        if (cfgModel) cfgModel.value = m;
        if (cfgModelSelect) cfgModelSelect.value = 'custom_input';
        if(cfgCustomModelWrap)cfgCustomModelWrap.style.display='block';
      } else if (val === 'custom') {
        if (cfgToolsMode) cfgToolsMode.value = cached.customToolsMode || 'auto';
        if (cfgBaseUrl) cfgBaseUrl.value = cached.baseUrl || 'http://localhost:11434/v1';
        if (cfgApiKey) cfgApiKey.value = (cached.apiKey && !cached.apiKey.startsWith('sk-zrev') && !cached.apiKey.startsWith('sk-bHH')) ? cached.apiKey : '';
        const m = cached.model || (cfgModel && cfgModel.value.trim() ? cfgModel.value.trim() : 'deepseek-r1');
        if (cfgModel) cfgModel.value = m;
        if (cfgModelSelect) cfgModelSelect.value = 'custom_input';
      }
    });
  }

  // 绑定快速预设填充标签点击
  document.querySelectorAll('.cfg-quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const m = chip.getAttribute('data-model');
      if (m && cfgModel) {
        cfgModel.value = m;
        cfgModel.focus();
      }
    });
  });

  // 模型选择下拉变化
  if (cfgModelSelect) {
    cfgModelSelect.addEventListener('change', () => {
      if (cfgModelSelect.value === 'custom_input') {
        if (cfgCustomModelWrap) cfgCustomModelWrap.style.display = 'block';
      } else {
        if (cfgCustomModelWrap) cfgCustomModelWrap.style.display = 'none';
        if (cfgModel) cfgModel.value = cfgModelSelect.value;
      }
    });
  }

  // 物理连通性测试
  if (btnTestConn) {
    btnTestConn.addEventListener('click', async () => {
      const curProvider = cfgProvider ? cfgProvider.value : 'minimax';
      let targetModel = '';
      if (curProvider === 'custom') {
        targetModel = cfgModel && cfgModel.value.trim() ? cfgModel.value.trim() : 'deepseek-r1';
      } else if (cfgModelSelect && cfgModelSelect.value !== 'custom_input') {
        targetModel = cfgModelSelect.value;
      } else {
        targetModel = cfgModel ? cfgModel.value.trim() : 'MiniMax-M3.1-Flash-Preview';
      }

      let targetKey = cfgApiKey ? cfgApiKey.value.trim() : '';
      if (!targetKey && curProvider === 'minimax') {
        targetKey = (window.ModelCatalog && typeof window.ModelCatalog.getDefaultMinimaxKey === 'function')
          ? window.ModelCatalog.getDefaultMinimaxKey()
          : (window.ModelCatalog?.getDefaultMinimaxKey?.() || (typeof atob === 'function' ? atob('c2stYkhIeXJtcTgwVVBMT2xiRVRwUjVMcGE0SFMzZ1ZieHA=') : ''));
      }
      if (!targetKey && curProvider !== 'custom') {
        if (testConnBanner) { testConnBanner.className = 'test-connection-banner error'; testConnBanner.textContent = '⚠️ 请先填写该 Provider 的 API Key（外部服务商需自备 Key）'; testConnBanner.classList.remove('hidden'); }
        return;
      }
      let targetBaseUrl = cfgBaseUrl ? cfgBaseUrl.value.trim() : '';
      if (!targetBaseUrl) {
        if (curProvider === 'minimax') {
          targetBaseUrl = 'https://api.botmeow.top/v1';
        } else if (curProvider === 'deepseek_official') {
          targetBaseUrl = 'https://api.deepseek.com/v1';
        } else if (curProvider === 'openai_official') {
          targetBaseUrl = 'https://api.openai.com/v1';
        } else if (curProvider === 'custom') {
          targetBaseUrl = 'http://localhost:11434/v1';
        }
      }

      if (testConnBanner) {
        testConnBanner.className = 'test-connection-banner info';
        testConnBanner.textContent = `⏳ 正在向 ${targetBaseUrl} 发送探测请求 (${targetModel})...`;
        testConnBanner.classList.remove('hidden');
      }

      btnTestConn.disabled = true;
      const revision=probeRevision;
      try {
        const client = window.UnifiedModelClient ? new window.UnifiedModelClient({
          baseURL: targetBaseUrl,
          baseUrl: targetBaseUrl,
          apiKey: targetKey,
          modelId: targetModel,
          model: targetModel,
          provider: curProvider,
          providerId: curProvider
        }) : null;

        if (!client) throw new Error('UnifiedModelClient 未载入');
        const probeRes = await client.testConnection(targetModel,{probeTools:true});
        if(revision!==probeRevision)return;

        if (testConnBanner) {
          if (probeRes.success) {
            testConnBanner.className = 'test-connection-banner success';
            testConnBanner.textContent = `✓ 本次鉴权与工具调用通过 (${probeRes.latencyMs}ms · ${probeRes.model})，测试函数仅用于协议检查。保存后生效。`;
            if(cfgToolsMode)cfgToolsMode.value='enabled';
          } else {
            testConnBanner.className = 'test-connection-banner error';
            testConnBanner.textContent = `✕ 连通性测试失败: ${probeRes.error || '请求异常'} (状态码: ${probeRes.code})`;
          }
        }
      } catch (err) {
        if(revision!==probeRevision)return;
        if (testConnBanner) {
          testConnBanner.className = 'test-connection-banner error';
          testConnBanner.textContent = `✕ 探测异常: ${err.message}`;
        }
      } finally {
        btnTestConn.disabled = false;
      }
    });
  }

  document.getElementById('btn-refresh-models')?.addEventListener('click',async event=>{
    const button=event.currentTarget,revision=probeRevision;button.disabled=true;
    try{const client=new window.UnifiedModelClient({providerId:cfgProvider.value,baseURL:cfgBaseUrl.value.trim(),apiKey:cfgApiKey.value.trim(),modelId:cfgModel.value.trim()});const ids=await client.listModels();if(revision!==probeRevision)return;cfgModelSelect.innerHTML='';const group=document.createElement('optgroup');group.label='账户可见模型 · 仍需工具测试';ids.forEach(id=>{const option=document.createElement('option');option.value=id;option.textContent=id;group.appendChild(option);});cfgModelSelect.appendChild(group);const manual=document.createElement('option');manual.value='custom_input';manual.textContent='✎ 手动输入其他模型名称...';cfgModelSelect.appendChild(manual);cfgModelSelect.value=ids.includes(cfgModel.value)?cfgModel.value:'custom_input';cfgPresetModelWrap.style.display='block';cfgCustomModelWrap.style.display=cfgModelSelect.value==='custom_input'?'block':'none';testConnBanner.className='test-connection-banner success';testConnBanner.textContent=`读取到 ${ids.length} 个模型；选择后测试工具调用。`;}
    catch(error){if(revision===probeRevision){testConnBanner.className='test-connection-banner error';testConnBanner.textContent='模型列表读取失败：'+error.message;}}
    finally{button.disabled=false;}
  });

  if (btnOpenModal) btnOpenModal.addEventListener('click', openApiModal);
  if (btnOpenModalNav) btnOpenModalNav.addEventListener('click', openApiModal);

  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener('click', () => modal.classList.add('hidden'));
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }

  if (btnClearApiKey) {
    btnClearApiKey.addEventListener('click', () => {
      const engine = getAgentEngine();
      if (engine) {
        const curProvider = cfgProvider ? cfgProvider.value : (engine.config?.provider || 'minimax');
        const isMinimax = curProvider === 'minimax';
        const clearedCfg = {
          provider: curProvider,
          model: engine.config?.model || (isMinimax ? 'MiniMax-M3.1-Flash-Preview' : (cfgModel?.value || 'deepseek-chat')),
          apiKey: '', // P0-1：清空即无凭证（模型不可用，不自动选共享凭证）
          apiKeys: { [curProvider]: '' },
          baseUrl: cfgBaseUrl?.value?.trim() || engine.config?.baseUrl || '',
          temperature: 0.7
        };
        if (isMinimax) clearedCfg.minimaxApiKey = '';
        engine.saveConfig(clearedCfg);
        if (engine.modelClient) {
          engine.modelClient.saveConfig({
            apiKey: '',
            providerId: curProvider,
            baseURL: clearedCfg.baseUrl,
            modelId: clearedCfg.model
          });
        }
        const cached = getCachedProviderConfigs();
        delete cached[curProvider];
        try { localStorage.setItem(PROVIDER_CONFIGS_STORAGE_KEY, JSON.stringify(cached)); } catch(_) { if (typeof recordIssue === 'function') recordIssue('SettingsController', 'btnClearApiKey', _); }
        if (cfgApiKey) cfgApiKey.value = '';
        syncProviderCredentialsUI(curProvider);
        if (promptInputDock) {
          promptInputDock.currentModelId = clearedCfg.model;
          promptInputDock.syncCurrentModelLabel();
          promptInputDock.renderPopoverModels();
        }
        updateAgentModeUI();
      }
      modal.classList.add('hidden');
    });
  }

  if (btnSaveCfg && modal) {
    btnSaveCfg.addEventListener('click', () => {
      const engine = getAgentEngine();
      if (engine) {
        const curProvider = cfgProvider ? cfgProvider.value : 'minimax';
        let chosenModel = '';
        if (curProvider === 'custom') {
          chosenModel = cfgModel && cfgModel.value.trim() ? cfgModel.value.trim() : 'deepseek-r1';
        } else if (cfgModelSelect && cfgModelSelect.value === 'custom_input') {
          chosenModel = cfgModel ? cfgModel.value.trim() : '';
        } else if (cfgModelSelect && cfgModelSelect.value) {
          chosenModel = cfgModelSelect.value;
        } else {
          chosenModel = cfgModel && cfgModel.value.trim() ? cfgModel.value.trim() : 'MiniMax-M3.1-Flash-Preview';
        }

        if(!chosenModel){testConnBanner.className='test-connection-banner error';testConnBanner.textContent='请选择或填写该账户的实际模型 ID。';return;}
        const isMinimax = (curProvider === 'minimax');
        let targetApiKey = cfgApiKey ? cfgApiKey.value.trim() : '';
        let targetBaseUrl = cfgBaseUrl && cfgBaseUrl.value.trim() ? cfgBaseUrl.value.trim() : '';
        if (!targetBaseUrl) {
          if (isMinimax) targetBaseUrl = 'https://api.botmeow.top/v1';
          else if (curProvider === 'deepseek_official') targetBaseUrl = 'https://api.deepseek.com/v1';
          else if (curProvider === 'openai_official') targetBaseUrl = 'https://api.openai.com/v1';
          else if (curProvider === 'custom') targetBaseUrl = 'http://localhost:11434/v1';
        }

        if (window.ModelCatalog && typeof window.ModelCatalog.validateModel === 'function') {
          const v = window.ModelCatalog.validateModel(chosenModel, targetApiKey, curProvider);
          if (!v.valid) {
            console.warn('[app.js]', v.message);
            if(testConnBanner){testConnBanner.className='test-connection-banner error';testConnBanner.textContent=v.message;}return;
          }
          chosenModel=v.modelId;
        }

        const newCfg = {
          provider: curProvider,
          apiKey: targetApiKey,
          model: chosenModel,
          customToolsMode: cfgToolsMode?.value || 'auto',
          baseUrl: targetBaseUrl
        };

        saveCachedProviderConfig(curProvider, newCfg);

        engine.saveConfig(newCfg);
        if (engine.modelClient) {
          engine.modelClient.saveConfig({
            baseURL: newCfg.baseUrl,
            apiKey: newCfg.apiKey,
            modelId: newCfg.model,
            providerId: newCfg.provider
          });
        }
        if (window.modelClient && window.modelClient !== engine.modelClient) {
          window.modelClient.saveConfig({
            baseURL: newCfg.baseUrl,
            apiKey: newCfg.apiKey,
            modelId: newCfg.model,
            providerId: newCfg.provider
          });
        }
        if (promptInputDock) {
          promptInputDock.currentModelId = chosenModel;
          promptInputDock.syncCurrentModelLabel();
          promptInputDock.renderPopoverModels();
        }
        updateAgentModeUI();
      }
      modal.classList.add('hidden');
    });
  }

  // 初始化顶栏状态指示灯
  updateAgentModeUI();


  return { openApiModal, updateAgentModeUI, getCachedProviderConfigs, saveCachedProviderConfig };
});
