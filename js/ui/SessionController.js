/** SessionController: browser UI responsibility with injected application dependencies. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.SessionController = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSessionController({ window, document, sessionHistoryManager, agentSessionStream, escapeHtml, formatMarkdownToHtml, renderInitialAgentGreeting, scrollStreamToBottom, getPromptTurnNavigator, getWorkspaceVisualizer, workspaceSessions, prompt, confirm, stop }) {
  function updateSessionHeaderUI() {
    if (!sessionHistoryManager) return;
    const cur = sessionHistoryManager.getActiveSession();
    const titleEl = document.getElementById('console-active-session-title');
    if (titleEl && cur) {
      titleEl.textContent = cur.title || '代数探究助教';
      titleEl.title = cur.title || '代数探究助教';
    }
    const badgeEl = document.getElementById('session-count-badge');
    if (badgeEl) {
      const all = sessionHistoryManager.getAllSessions();
      badgeEl.textContent = String(all.length);
    }
  }

  function toggleSessionDrawer(show = null) {
    const drawer = document.getElementById('session-history-drawer');
    const backdrop = document.getElementById('session-history-backdrop');
    if (!drawer) return;

    const willShow = show !== null ? show : drawer.classList.contains('hidden');
    if (willShow) {
      drawer.classList.remove('hidden');
      if (backdrop) backdrop.classList.remove('hidden');
      renderSessionDrawerList();
      const input = document.getElementById('session-search-input');
      if (input) {
        input.value = '';
        input.focus();
      }
    } else {
      drawer.classList.add('hidden');
      if (backdrop) backdrop.classList.add('hidden');
    }
  }

  function renderSessionDrawerList(filterQuery = '') {
    const listEl = document.getElementById('session-history-list');
    if (!listEl || !sessionHistoryManager) return;

    const sessions = filterQuery
      ? sessionHistoryManager.searchSessions(filterQuery)
      : sessionHistoryManager.getAllSessions();

    const activeId = sessionHistoryManager.getActiveSessionId();

    if (sessions.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:24px 12px;color:#94a3b8;font-size:12px;">
          暂无匹配的历史探究任务
        </div>
      `;
      return;
    }

    listEl.innerHTML = sessions.map(s => {
      const isActive = s.id === activeId;
      const turnCount = (s.turns && s.turns.length) || 0;
      const lastTurn = turnCount > 0 ? s.turns[turnCount - 1] : null;
      const snippet = lastTurn ? (lastTurn.userQuery || lastTurn.assistantResponse || '') : '空白新探究';
      const timeStr = sessionHistoryManager.formatRelativeTime(s.updatedAt);

      return `
        <div class="session-card ${isActive ? 'active' : ''}" data-session-id="${escapeHtml(s.id)}">
          <div class="session-card-header">
            <div class="session-card-title-wrap">
              ${s.pinned ? '<span class="session-pin-icon" title="已置顶">📌</span>' : ''}
              <span class="session-card-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
            </div>
            <div class="session-card-actions">
              <button type="button" class="btn-card-action pin-btn" title="${s.pinned ? '取消置顶' : '置顶任务'}">${s.pinned ? '★' : '☆'}</button>
              <button type="button" class="btn-card-action rename-btn" title="重命名">✏️</button>
              <button type="button" class="btn-card-action delete-btn delete" title="删除任务">🗑️</button>
            </div>
          </div>
          <div class="session-card-snippet">${escapeHtml(snippet.slice(0, 40))}</div>
          <div class="session-card-meta">
            <span>${turnCount} 轮推演</span>
            <span>${escapeHtml(timeStr)}</span>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.session-card').forEach(card => {
      const sId = card.getAttribute('data-session-id');

      card.addEventListener('click', (e) => {
        if (e.target.closest('.session-card-actions')) return;
        if (switchSession(sId) !== false) toggleSessionDrawer(false);
      });

      const pinBtn = card.querySelector('.pin-btn');
      if (pinBtn) {
        pinBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          try { sessionHistoryManager.togglePinSession(sId); } catch (error) { showSessionError(error.message); return; }
          renderSessionDrawerList(document.getElementById('session-search-input')?.value || '');
        });
      }

      const renameBtn = card.querySelector('.rename-btn');
      if (renameBtn) {
        renameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cur = sessionHistoryManager.getAllSessions().find(x => x.id === sId);
          const newTitle = prompt('重命名探究任务：', cur ? cur.title : '');
          if (newTitle && newTitle.trim()) {
            try { sessionHistoryManager.renameSession(sId, newTitle.trim()); } catch (error) { showSessionError(error.message); return; }
            updateSessionHeaderUI();
            renderSessionDrawerList(document.getElementById('session-search-input')?.value || '');
          }
        });
      }

      const delBtn = card.querySelector('.delete-btn');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm('确认删除此项探究任务？')) {
            const wasActive = (sId === sessionHistoryManager.getActiveSessionId());
            try { if (wasActive) workspaceSessions?.prepareLeave?.(); sessionHistoryManager.deleteSession(sId); }
            catch (error) { showSessionError(error.message); return; }
            if (wasActive) {
              const remaining = sessionHistoryManager.getAllSessions();
              const nextId = remaining.length > 0 ? remaining[0].id : null;
              if (nextId) {
                switchSession(nextId);
              } else {
                const fresh = sessionHistoryManager.createSession('新探究任务');
                switchSession(fresh.id);
              }
            } else {
              updateSessionHeaderUI();
              renderSessionDrawerList(document.getElementById('session-search-input')?.value || '');
            }
          }
        });
      }
    });
  }

  function switchSession(sessionId) {
    if (typeof stop === 'function') {
      try { stop(); } catch (e) { console.warn('[switchSession] 停止活跃推理异常:', e); }
    }
    const promptTurnNavigator = getPromptTurnNavigator();
    const workspaceVisualizer = getWorkspaceVisualizer();
    if (!sessionHistoryManager) return;
    if (!sessionHistoryManager.getSessionById(sessionId)) return;
    let session;
    try { if (workspaceSessions) workspaceSessions.activate(sessionId); session = sessionHistoryManager.setActiveSession(sessionId); }
    catch (error) { showSessionError(error.message); return false; }
    if (!session) return;

    updateSessionHeaderUI();
    renderSessionDrawerList();

    if (!agentSessionStream) return;
    agentSessionStream.innerHTML = '';
    agentSessionStream.classList.remove('no-hint-mode', 'hint-revealed');
    const hintBanner = document.getElementById('no-hint-banner'); if (hintBanner) hintBanner.style.display = 'none';

    if (!session.turns || session.turns.length === 0) {
      renderInitialAgentGreeting();
      if (promptTurnNavigator) {
        promptTurnNavigator.clear();
      }
    } else {
      for (const turn of session.turns) {
        if (turn.userQuery) {
          const userMsgEl = document.createElement('div');
          userMsgEl.className = 'user-msg-bubble';
          userMsgEl.innerHTML = `<div>${escapeHtml(turn.userQuery)}</div>`;
          agentSessionStream.appendChild(userMsgEl);
        }

        const responseBlock = document.createElement('div');
        responseBlock.className = 'agent-response-block';

        if (turn.thoughtChain && window.ReasoningBlock) {
          const rb = new window.ReasoningBlock({ container: responseBlock, defaultOpen: false });
          rb.appendChunk(turn.thoughtChain);
          if (turn.status === 'aborted' || turn.status === 'incomplete') rb.stopStreaming(turn.status === 'aborted' ? 'aborted' : 'failed');
          else rb.finishStreaming(turn.elapsedSeconds || 0.5);
          rb.setOpen(false);
        }

        if (turn.steps && turn.steps.length > 0 && window.ToolCallStreamTree) {
          const tree = new window.ToolCallStreamTree({ container: responseBlock });
          tree.setNodes(turn.steps);
        }

        if (turn.assistantResponse) {
          const answerContentEl = document.createElement('div');
          answerContentEl.className = 'agent-final-answer';
          answerContentEl.style.display = 'block';
          answerContentEl.innerHTML = formatMarkdownToHtml(turn.assistantResponse, { isStreaming: false });
          if (window.KaTeXRenderer) {
            window.KaTeXRenderer.renderElement(answerContentEl);
          }
          responseBlock.appendChild(answerContentEl);
        }

        if (turn.status === 'aborted' || turn.status === 'incomplete') {
          const status = document.createElement('div'); status.className = 'agent-mode-banner';
          status.textContent = turn.status === 'aborted' ? '已停止 · 可继续提问' : '回答未完成 · 可发送“继续”'; responseBlock.appendChild(status);
        }
        agentSessionStream.appendChild(responseBlock);
      }
      if (promptTurnNavigator) {
        promptTurnNavigator.rebuildFromDOM();
      }
      scrollStreamToBottom();
    }

    if (!workspaceSessions && session.matrixState && workspaceVisualizer && typeof workspaceVisualizer.applyMatrixDirect === 'function') {
      try {
        workspaceVisualizer.applyMatrixDirect(session.matrixState);
      } catch (e) {
        console.warn('[switchSession] 矩阵状态还原跳过:', e);
      }
    }
  }

  function bindSessionDrawerEvents() {
    const createNewSession = () => {
      try { workspaceSessions?.prepareLeave?.(); const s=sessionHistoryManager.createSession('新探究任务');if(switchSession(s.id)!==false)toggleSessionDrawer(false); }
      catch(error) { showSessionError(error.message); }
    };
    const btnHistory = document.getElementById('btn-session-history');
    if (btnHistory) {
      btnHistory.addEventListener('click', () => toggleSessionDrawer());
    }

    const backdrop = document.getElementById('session-history-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => toggleSessionDrawer(false));
    }

    const btnClose = document.getElementById('btn-close-session-drawer');
    if (btnClose) {
      btnClose.addEventListener('click', () => toggleSessionDrawer(false));
    }

    const btnNew = document.getElementById('btn-new-session');
    if (btnNew) {
      btnNew.addEventListener('click', () => {
        if (!sessionHistoryManager) return;
        createNewSession();
      });
    }

    const btnDrawerNew = document.getElementById('btn-drawer-new-task');
    if (btnDrawerNew) {
      btnDrawerNew.addEventListener('click', () => {
        if (!sessionHistoryManager) return;
        createNewSession();
      });
    }

    const searchInput = document.getElementById('session-search-input');
    const exportButton = document.getElementById('btn-export-sessions');
    if (exportButton) {
      exportButton.addEventListener('click', () => {
        try {
          workspaceSessions?.capture();
          const data = {
            schema: 'wenju-session-records/1',
            exportedAt: new Date().toISOString(),
            activeSessionId: sessionHistoryManager.getActiveSessionId(),
            sessions: sessionHistoryManager.sessions
          };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const dateStr = new Date().toISOString().slice(0, 10);
          link.download = `wenju-sessions-${dateStr}.json`;
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          showSessionNotice('会话记录导出成功', true);
        } catch (error) {
          showSessionNotice('导出失败：' + error.message, false);
        }
      });
    }

    const importButton = document.getElementById('btn-import-sessions');
    const importInput = document.getElementById('input-import-sessions');
    if (importButton && importInput) {
      importButton.addEventListener('click', () => {
        importInput.value = '';
        importInput.click();
      });
      importInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch (err) {
            throw new Error('所选文件不是合法的 JSON 格式');
          }
          let listToImport = null;
          if (parsed && Array.isArray(parsed.sessions)) {
            listToImport = parsed.sessions;
          } else if (Array.isArray(parsed)) {
            listToImport = parsed;
          } else {
            throw new Error('未识别的会话数据结构（缺少 sessions 数组）');
          }

          if (typeof sessionHistoryManager.importSessions === 'function') {
            const res = sessionHistoryManager.importSessions(listToImport);
            renderSessionDrawerList();
            showSessionNotice(`成功导入并合并 ${res.importedCount} 个探究任务`, true);
          } else {
            throw new Error('底层存储管理器不支持 importSessions 接口');
          }
        } catch (error) {
          showSessionNotice('导入失败：' + error.message, false);
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        renderSessionDrawerList(searchInput.value);
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const drawer = document.getElementById('session-history-drawer');
        if (drawer && !drawer.classList.contains('hidden')) {
          toggleSessionDrawer(false);
        }
      }
    });
  }


  function showSessionNotice(message, isSuccess = false) {
    let box = document.getElementById('session-operation-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'session-operation-error';
      box.className = isSuccess ? 'session-operation-notice success' : 'session-operation-error';
      box.setAttribute('role', 'alert');
      const rail = agentSessionStream?.parentElement;
      rail?.parentElement?.insertBefore(box, rail);
    } else {
      box.className = isSuccess ? 'session-operation-notice success' : 'session-operation-error';
    }
    const text = document.createElement('span');
    text.textContent = (isSuccess ? '✅ ' : '⚠️ ') + message;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭存储提示');
    close.onclick = () => box.remove();
    box.replaceChildren(text, close);
    if (isSuccess) {
      setTimeout(() => { if (box.parentElement) box.remove(); }, 3500);
    }
  }

  function showSessionError(message) {
    showSessionNotice(message, false);
  }

  if (typeof sessionHistoryManager?.subscribe === 'function') {
    sessionHistoryManager.subscribe((event, data) => {
      if (event === 'storage_error') showSessionError(data.message);
    });
  }
  return { updateSessionHeaderUI, toggleSessionDrawer, renderSessionDrawerList, switchSession, bindSessionDrawerEvents };
});
