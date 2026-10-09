/**
 * dsh-disable-unofficial-plugins —— 客户端半（Web）。
 *
 * 职责：在官方「插件」页「已安装」分组标题行的最右侧注入一个开关按钮：
 *   · 仍有启用的非官方插件 —— 显示「停用非官方插件…」，点开一张勾选清单
 *     （默认全选），确认后只停用勾中的那些；
 *   · 已全部停用           —— 翻转为「启用非官方插件…」，同样勾选后启用。
 * 只切换组合包层的启停，既不安装也不卸载，官方插件与只读项一律不碰。
 * （最初的 1.0.0 是「一次点击全部停用」，1.1.0 起改成勾选清单，此处口径已同步。）
 *
 * 语言：全部用户可见文案都走官方 locale 服务（@deepseek-ai/dsh-client-locale）——
 * 用 `ctx.locale.register(NS, { zh, en })` 注册中英两套字典、`ctx.locale.bind(NS)`
 * 取翻译器，并订阅 locale 变化重画按钮与当前弹窗，因此跟随宿主软件的语言设置
 * （「设置 → 通用 → 语言」）实时切换，与官方界面同一套口径。宿主没有 locale 服务
 * 时退回按浏览器语言判断（与 DSH 同规则：识别不出时用英文）。
 * `cancel` / `close` 这类通用词不写进本字典，交给 locale 服务的 `common` 命名空间，
 * 这样第三方语言包只翻一次、全界面一致。
 *
 * 实现方式：纯原生 DOM 注入，不引入 React、不重绘官方 React 树。
 * 只在分组标题行（section[data-plugin-group="bundles"] > .groupHead）尾部追加
 * 一个自带 `margin-left:auto` + `align-self:center` 的独立节点，高度取标题行
 * 行高（.groupTitle 的 line-height:22px），因此原有 h3 / 计数 span 的位置与
 * 整行行高都不变。
 *
 * 数据与写操作全部走宿主远程服务 `ctx.remote.pluginManager`：
 *   listBundles():  Promise<RemoteResult<BundleInfo[]>>
 *   setBundleEnabled(name, enabled): Promise<RemoteResult<ChangeResult>>
 * 远程返回值统一为 { ok: true, value } | { ok: false, error: { code, message } }。
 *
 * ── 主题侧补丁（EVA-Inspired-Theme，D79 / 2026-10-09）────────────────────
 * 本文件按 D29 是上游 v1.3.0 客户端半的逐字节副本。主题侧此后打了五处**只关乎
 * 性能、不改行为**的补丁，刷新上游（用新版 lib/client.js 覆盖本文件再重建）时必须重贴：
 *   a. `reload()` 加序号守卫 —— 只有最后一次调用允许写 snapshot，先发的旧响应不再覆盖新快照；
 *   b. 事件驱动的重载改走 `scheduleReload()` 单槽去抖 —— 原为每个事件一次并发 RPC；
 *   c. `setText()` 先比后写按钮文案 —— textContent 每次赋值都会叫醒本插件自己的 observer；
 *   d. 运行弹窗的正文按 ~80ms 墙钟节流重画 —— 原为每完成一项就重画整张清单（O(n²)），
 *      最后一项与语言切换仍然必画；
 *   e. `reasons` 的去重换成 Set —— 原来是 `filter((r,i,a) => a.indexOf(r) === i)`（O(n²)）。
 * 本机已无上游 checkout，因此这五处只登记在这里、`NOTICE` 第 4 节与 `docs/design.md` 的 D79，
 * 并由 `tools/selfcheck.mjs` 的 cli.28 钉住（绊线，不是哈希）。
 * ────────────────────────────────────────────────────────────────────────
 */
window.__ModuleLoader__.load({
	id: 'dsh-disable-unofficial-plugins',
	factory: () => {
		/* ================================================================== *
		 * 一、判定口径与常量
		 * ================================================================== */

		/** 本插件自身的包名：批量停用时必须排除自己，否则点一次按钮就把自己停掉了。 */
		const SELF = 'dsh-disable-unofficial-plugins';

		/**
		 * 「非官方」的判据：**组合包名不以 `@deepseek-ai/` 开头**。
		 * DSH 安装自带的组合包全部发布在 `@deepseek-ai/` 作用域下；
		 * 社区 / 第三方插件（含 `@michengai/`、`@liustack/` 等其它作用域）一律不在此列。
		 */
		const OFFICIAL_SCOPE = '@deepseek-ai/';

		/** 官方页 renderGroup 的既有口径：这些内置组合包不进任何分组，本按钮也不涉及。 */
		const BUILTIN_PROFILE_BUNDLES = new Set([
			'@deepseek-ai/dsh-base',
			'@deepseek-ai/dsh-web-app',
			'@deepseek-ai/dsh-headless',
			'@deepseek-ai/dsh-sdk-app',
			'@deepseek-ai/dsh-acp-app',
			'@deepseek-ai/dsh-sdk-minimal'
		]);

		/** 「已安装」分组标题行：renderGroup 渲染为 section > .groupHead（h3 + 计数 span）。 */
		const GROUP_SELECTOR = 'section[data-plugin-group="bundles"]';
		const MARK = 'data-dsh-dup';
		const CSS_MARK = 'data-dsh-dup-css';

		/* ------------------------------------------------------------------ *
		 * 文案与语言
		 * ------------------------------------------------------------------ */

		/**
		 * 文案命名空间，注册进官方 locale 服务（@deepseek-ai/dsh-client-locale）。
		 * 对象形式 `register(ns, { zh, en })` 要求两套 shipped locale 齐全：
		 * 某个键在 active 语言里缺失时会沿 fallback 链退回 en，所以下面
		 * zh / en 的键必须一一对应，不能只写一边。
		 */
		const NS = 'disableUnofficialPlugins';

		/** 当前翻译器：apply() 从 locale 服务取到后写入；为 null 时走 fallbackTranslate。 */
		let translate = null;

		/**
		 * 中英两套文案。zh 一律保持插件原有的中文原文（含全角标点），
		 * 保证中文界面下的观感与改造前逐字一致。
		 * 故意不写 `cancel` / `close`：locale 服务的查找顺序是
		 * 「本命名空间 → common → 键名本身」，留给 common 才能让语言包只翻一次。
		 */
		const DICT = {
			zh: {
				'panel.button.disable': '停用非官方插件…',
				'panel.button.enable': '启用非官方插件…',
				'panel.title.busy.disable': '正在停用非官方插件…',
				'panel.title.busy.enable': '正在启用非官方插件…',
				'panel.title.busy.generic': '正在处理非官方插件…',
				'panel.title.loading': '正在读取插件列表…',
				'panel.title.error': '无法读取插件列表',
				'panel.title.error.retrying': '（已重试 {count} 次，仍在等待服务就绪）',
				'panel.title.none.blocked': '没有可切换的非官方插件（{count} 个只读项既停不了也启用不了）',
				'panel.title.none.empty': '没有安装任何非官方插件',
				'panel.title.disable': '选择要停用的非官方插件（共 {count} 个可停用，只停用不卸载）{extra}',
				'panel.title.enable': '选择要启用的非官方插件（共 {count} 个可启用，只启用不安装）{extra}',
				'panel.title.blockedExtra': '，另有 {count} 个只读项会被跳过',
				'dialog.title.disable': '停用非官方插件',
				'dialog.title.enable': '启用非官方插件',
				'dialog.desc.disable':
					'勾选要停用的插件（默认全选）。只从当前生效的组合包层中移除，' +
					'不会卸载插件、不会删除插件文件与配置数据；官方插件不受影响。',
				'dialog.desc.enable':
					'勾选要启用的插件（默认全选）。只把它们加回当前生效的组合包层，' +
					'不会下载或安装任何东西、不会改动插件文件与配置数据；官方插件不受影响。',
				'dialog.selectAll': '全选',
				'dialog.selectNone': '全不选',
				'dialog.count': '已选 {chosen} / {total}',
				'dialog.blocked.disable': '另有 {count} 个非官方插件为只读项（{reasons}），无法停用，不会出现在上面的清单里。',
				'dialog.blocked.enable': '另有 {count} 个非官方插件为只读项（{reasons}），无法启用，不会出现在上面的清单里。',
				'dialog.self.disable': '本插件自身（{self}）不在停用范围内。',
				'dialog.self.enable': '本插件自身（{self}）不在启用范围内。',
				'dialog.primary.disable': '停用 {count} 个插件',
				'dialog.primary.enable': '启用 {count} 个插件',
				'dialog.diagnostics': '完整诊断',
				'list.separator': '、',
				'status.pending': '等待中',
				'status.applied.disable': '已停用',
				'status.applied.enable': '已启用',
				'status.restart.disable': '已停用（重启后生效）',
				'status.restart.enable': '已启用（重启后生效）',
				'status.overridden': '未生效（被更高层覆盖）',
				'status.cancelled': '已取消',
				'status.skipped': '已跳过',
				'status.failed': '失败',
				'run.title.disable': '正在停用非官方插件',
				'run.title.enable': '正在启用非官方插件',
				'run.desc.disable': '正在停用…（{done} / {total}）',
				'run.desc.enable': '正在启用…（{done} / {total}）',
				'run.note.cancelled': '操作被取消',
				'run.note.overridden': '被更高优先级的层覆盖，未生效',
				'run.note.restart': '重启 DSH 后生效',
				'run.note.exception': '调用异常',
				'run.note.callFailed': '调用失败',
				'run.note.verbFailed.disable': '停用失败',
				'run.note.verbFailed.enable': '启用失败',
				'result.title.done.disable': '停用完成',
				'result.title.done.enable': '启用完成',
				'result.title.partial.disable': '停用完成（部分未成功）',
				'result.title.partial.enable': '启用完成（部分未成功）',
				'result.summary.success.disable': '成功停用 {count} 个非官方插件',
				'result.summary.success.enable': '成功启用 {count} 个非官方插件',
				'result.summary.failed': '；{count} 个未成功',
				'result.summary.skipped': '；跳过 {count} 个只读项',
				'result.summary.end': '。',
				'result.summary.restart': '其中 {count} 个将在下次启动 DSH 后生效。',
				'result.sect.failed': '未成功（{count}）',
				'result.sect.skipped': '已跳过（{count}）',
				'result.note.readonly': '只读：{reason}',
				'result.details.disable': '已停用（{count}）',
				'result.details.enable': '已启用（{count}）',
				'result.empty': '没有任何改动。',
				'error.notReady.remote': '插件管理服务未就绪（remote 服务不可用）',
				'error.notReady.namespace': '插件管理服务未就绪（remote 已在，remote.pluginManager 尚未挂载，正在等待）',
				'error.notReady.method': '插件管理服务未就绪（remote.pluginManager.listBundles 不可用）',
				'error.listBundles': 'listBundles 调用失败',
				'error.separator': '：',
				'error.incompatible': '不兼容：{list}',
				'error.incompatibleItem': '{pkg}（运行时 {runtime}）',
				'error.unknown': '未知',
				'error.readList': '无法读取插件列表',
				'error.unknownError': '未知错误'
			},
			en: {
				'panel.button.disable': 'Disable unofficial plugins…',
				'panel.button.enable': 'Enable unofficial plugins…',
				'panel.title.busy.disable': 'Disabling unofficial plugins…',
				'panel.title.busy.enable': 'Enabling unofficial plugins…',
				'panel.title.busy.generic': 'Working on unofficial plugins…',
				'panel.title.loading': 'Reading the plugin list…',
				'panel.title.error': 'Cannot read the plugin list',
				'panel.title.error.retrying': ' (retried {count} times, still waiting for the service to be ready)',
				'panel.title.none.blocked': 'No switchable unofficial plugins ({count} read-only entries can be neither disabled nor enabled)',
				'panel.title.none.empty': 'No unofficial plugins are installed',
				'panel.title.disable': 'Choose the unofficial plugins to disable ({count} can be disabled; disable only, never uninstall){extra}',
				'panel.title.enable': 'Choose the unofficial plugins to enable ({count} can be enabled; enable only, never install){extra}',
				'panel.title.blockedExtra': '; {count} read-only entries will be skipped',
				'dialog.title.disable': 'Disable unofficial plugins',
				'dialog.title.enable': 'Enable unofficial plugins',
				'dialog.desc.disable':
					'Check the plugins to disable (all checked by default). They are only removed ' +
					'from the currently active bundle layer: nothing is uninstalled, and no plugin ' +
					'files or configuration data are deleted. Official plugins are unaffected.',
				'dialog.desc.enable':
					'Check the plugins to enable (all checked by default). They are only added back ' +
					'to the currently active bundle layer: nothing is downloaded or installed, and no ' +
					'plugin files or configuration data are touched. Official plugins are unaffected.',
				'dialog.selectAll': 'Select all',
				'dialog.selectNone': 'Select none',
				'dialog.count': '{chosen} of {total} selected',
				'dialog.blocked.disable': '{count} more unofficial plugins are read-only ({reasons}) and cannot be disabled; they are not listed above.',
				'dialog.blocked.enable': '{count} more unofficial plugins are read-only ({reasons}) and cannot be enabled; they are not listed above.',
				'dialog.self.disable': 'This plugin itself ({self}) is not part of the disable scope.',
				'dialog.self.enable': 'This plugin itself ({self}) is not part of the enable scope.',
				'dialog.primary.disable': 'Disable {count} plugins',
				'dialog.primary.enable': 'Enable {count} plugins',
				'dialog.diagnostics': 'Full diagnostics',
				'list.separator': ', ',
				'status.pending': 'Pending',
				'status.applied.disable': 'Disabled',
				'status.applied.enable': 'Enabled',
				'status.restart.disable': 'Disabled (takes effect after a restart)',
				'status.restart.enable': 'Enabled (takes effect after a restart)',
				'status.overridden': 'Not applied (overridden by a higher layer)',
				'status.cancelled': 'Cancelled',
				'status.skipped': 'Skipped',
				'status.failed': 'Failed',
				'run.title.disable': 'Disabling unofficial plugins',
				'run.title.enable': 'Enabling unofficial plugins',
				'run.desc.disable': 'Disabling… ({done} / {total})',
				'run.desc.enable': 'Enabling… ({done} / {total})',
				'run.note.cancelled': 'The operation was cancelled',
				'run.note.overridden': 'Overridden by a higher-priority layer, so it did not take effect',
				'run.note.restart': 'Takes effect after DSH restarts',
				'run.note.exception': 'The call threw an error',
				'run.note.callFailed': 'The call failed',
				'run.note.verbFailed.disable': 'Disable failed',
				'run.note.verbFailed.enable': 'Enable failed',
				'result.title.done.disable': 'Disable complete',
				'result.title.done.enable': 'Enable complete',
				'result.title.partial.disable': 'Disable complete (not everything succeeded)',
				'result.title.partial.enable': 'Enable complete (not everything succeeded)',
				'result.summary.success.disable': 'Disabled {count} unofficial plugins',
				'result.summary.success.enable': 'Enabled {count} unofficial plugins',
				'result.summary.failed': '; {count} failed',
				'result.summary.skipped': '; skipped {count} read-only entries',
				'result.summary.end': '.',
				'result.summary.restart': ' {count} of them take effect after DSH restarts.',
				'result.sect.failed': 'Failed ({count})',
				'result.sect.skipped': 'Skipped ({count})',
				'result.note.readonly': 'Read-only: {reason}',
				'result.details.disable': 'Disabled ({count})',
				'result.details.enable': 'Enabled ({count})',
				'result.empty': 'Nothing changed.',
				'error.notReady.remote': 'The plugin management service is not ready (the remote service is unavailable)',
				'error.notReady.namespace': 'The plugin management service is not ready (remote is present, remote.pluginManager is not mounted yet; waiting)',
				'error.notReady.method': 'The plugin management service is not ready (remote.pluginManager.listBundles is unavailable)',
				'error.listBundles': 'The listBundles call failed',
				'error.separator': ': ',
				'error.incompatible': 'Incompatible: {list}',
				'error.incompatibleItem': '{pkg} (runtime {runtime})',
				'error.unknown': 'unknown',
				'error.readList': 'Cannot read the plugin list',
				'error.unknownError': 'Unknown error'
			}
		};

		/**
		 * 只在「宿主根本没有 locale 服务」时才用得到的 common 文案。
		 * 正常情况下这些词由 locale 服务的 common 命名空间提供。
		 */
		const COMMON_FALLBACK = {
			zh: { cancel: '取消', close: '关闭' },
			en: { cancel: 'Cancel', close: 'Close' }
		};

		/** 按浏览器语言判断兜底语言（primary subtag 命中 zh / en），识别不出时与 DSH 一致用 en。 */
		function browserLocale() {
			let tags = [];
			try {
				if (typeof navigator !== 'undefined' && navigator) {
					tags =
						Array.isArray(navigator.languages) && navigator.languages.length > 0
							? navigator.languages.slice()
							: [navigator.language];
				}
			} catch (err) {
				tags = [];
			}
			for (const tag of tags) {
				if (typeof tag !== 'string') continue;
				const primary = tag.toLowerCase().split('-')[0];
				if (primary === 'zh') return 'zh';
				if (primary === 'en') return 'en';
			}
			return 'en';
		}

		/** 无 locale 服务时的翻译器：本命名空间 → en → common → 键名，与官方查找顺序同构。 */
		function fallbackTranslate(key, params) {
			const lang = browserLocale();
			const table = DICT[lang] || DICT.en;
			const common = COMMON_FALLBACK[lang] || COMMON_FALLBACK.en;
			let template;
			if (table[key] !== undefined) template = table[key];
			else if (DICT.en[key] !== undefined) template = DICT.en[key];
			else if (common[key] !== undefined) template = common[key];
			else template = key;
			if (!params) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
		}

		/** 全插件唯一的取文案入口：`T('panel.button.disable')` / `T('dialog.count', { chosen, total })`。 */
		function T(key, params) {
			return (translate || fallbackTranslate)(key, params);
		}

		const SYNC_THROTTLE_MS = 150;
		/**
		 * 等待 `remote.pluginManager` 挂载的重试节奏。
		 *
		 * 宿主侧 `@deepseek-ai/dsh-api-remotes` 的客户端半 `inject = ["remote"]`，
		 * 其 apply 是 async 且依次 await 25 个 `ctx.remote.$mount(contribution)`；
		 * 本插件也 inject "remote"（外加只管文案语言的 "locale"）而 apply 是同步的，
		 * 因此必然在命名空间挂载完成**之前**就跑到 apply —— 那一刻 remote 已在、
		 * remote.pluginManager 还没挂上。所以首次读取必定失败，靠这里的轮询等它挂上来。
		 */
		const RETRY_INTERVAL_MS = 250;
		const RETRY_MAX = 120; // ≈30s，足够覆盖宿主异步挂载；超时后停手并保留错误提示

		/**
		 * 结果分类的展示元数据，键与 ChangeResult.application 对齐。
		 * 文案里的动作词随本次是停用还是启用变，所以 key 是 (mode) => 字典键。
		 */
		const STATUS = {
			pending: { mark: '·', tone: 'idle', key: () => 'status.pending' },
			applied: { mark: '✓', tone: 'ok', key: (mode) => `status.applied.${mode}` },
			restart: { mark: '✓', tone: 'ok', key: (mode) => `status.restart.${mode}` },
			overridden: { mark: '!', tone: 'warn', key: () => 'status.overridden' },
			cancelled: { mark: '–', tone: 'idle', key: () => 'status.cancelled' },
			skipped: { mark: '–', tone: 'idle', key: () => 'status.skipped' },
			failed: { mark: '✕', tone: 'error', key: () => 'status.failed' }
		};

		/** 两种职责的完整描述：目标状态（setBundleEnabled 的第二实参）与字典键后缀。 */
		const MODE = {
			disable: { enable: false },
			enable: { enable: true }
		};

		const CLOSE_ICON =
			'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
			'<path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" stroke="currentColor" ' +
			'stroke-width="1.4" stroke-linecap="round"/></svg>';

		/**
		 * 样式表。类名一律加 `dsh-dup-` 前缀；取值全部复用官方主题 token
		 * （尺寸与配色取自 @deepseek-ai/dsh-client-ui-primitives 的
		 * Button.module.css / Modal.module.css），每个 token 都带兜底值。
		 */
		const CSS = `
.dsh-dup-slot{margin-left:auto;align-self:center;display:inline-flex;flex:0 0 auto;box-sizing:border-box}
.dsh-dup-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;height:22px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-label-secondary,inherit);font-family:inherit;font-size:12px;font-weight:400;line-height:16px;white-space:nowrap;cursor:pointer;transition:background-color var(--ds-transition-duration,.15s) var(--ds-ease-in-out,ease),color var(--ds-transition-duration,.15s) var(--ds-ease-in-out,ease)}
.dsh-dup-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));color:var(--dsw-alias-label-primary,inherit)}
.dsh-dup-btn:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18))}
.dsh-dup-btn:disabled{cursor:not-allowed;opacity:.4}
.dsh-dup-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dsh-dup-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px;box-sizing:border-box}
.dsh-dup-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.35));backdrop-filter:var(--dsw-mask-blur)}
.dsh-dup-dialog{position:relative;display:flex;flex-direction:column;gap:20px;box-sizing:border-box;width:min(380px,100%);max-height:100%;padding:0 0 24px;border-radius:var(--dsw-radius-panel,12px);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#fff));box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);overflow:hidden}
.dsh-dup-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
.dsh-dup-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-dup-close{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;box-sizing:border-box;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-dup-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-dup-close:disabled{cursor:not-allowed;opacity:.4}
.dsh-dup-desc{margin:0;padding:0 24px;font-size:14px;line-height:22px;font-weight:400;color:var(--dsw-alias-label-primary)}
.dsh-dup-body{display:flex;flex-direction:column;gap:12px;min-height:0;padding:0 24px;overflow:auto}
.dsh-dup-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}
.dsh-dup-desc[hidden],.dsh-dup-body[hidden],.dsh-dup-foot[hidden]{display:none}
.dsh-dup-action{display:inline-flex;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;font-weight:400;line-height:22px;white-space:nowrap;cursor:pointer}
.dsh-dup-action.is-outline{border:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35))}
.dsh-dup-action.is-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsh-dup-action.is-primary{background:var(--dsw-alias-button-primary-fill,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff)}
.dsh-dup-action.is-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#3f5be8)}
.dsh-dup-action:disabled{cursor:not-allowed;opacity:.4}
.dsh-dup-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}
.dsh-dup-list{margin:0;padding:6px 8px;list-style:none;display:flex;flex-direction:column;gap:2px;max-height:200px;overflow:auto;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:var(--dsw-radius-sm,4px)}
.dsh-dup-list>li{display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:20px}
.dsh-dup-pick{display:flex;align-items:baseline;gap:8px;flex:1 1 auto;min-width:0;cursor:pointer}
.dsh-dup-box{flex:0 0 auto;width:13px;height:13px;margin:0;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:pointer;transform:translateY(1.5px)}
.dsh-dup-tools{display:flex;align-items:center;gap:12px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.dsh-dup-count{margin-right:auto;font-variant-numeric:tabular-nums}
.dsh-dup-link{padding:0;border:none;border-radius:2px;background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);font-family:inherit;font-size:12px;line-height:20px;cursor:pointer}
.dsh-dup-link:hover{text-decoration:underline}
.dsh-dup-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}
.dsh-dup-mark{flex:0 0 auto;width:12px;text-align:center;font-size:12px;line-height:20px}
.dsh-dup-mark.is-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-dup-mark.is-warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-dup-mark.is-error{color:var(--dsw-alias-state-error-primary)}
.dsh-dup-mark.is-idle{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-caption))}
.dsh-dup-name{flex:0 1 auto;min-width:8em;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;word-break:break-all;color:var(--dsw-alias-label-primary)}
.dsh-dup-note{flex:1 1 auto;min-width:0;padding-left:8px;font-size:12px;line-height:20px;text-align:right;overflow-wrap:anywhere;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.dsh-dup-note.is-warn{color:var(--dsw-alias-state-warn-primary)}
.dsh-dup-note.is-error{color:var(--dsw-alias-state-error-primary)}
.dsh-dup-sect{display:flex;flex-direction:column;gap:6px}
.dsh-dup-sect-title{margin:0;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.dsh-dup-details{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dsh-dup-details>summary{cursor:pointer;padding:2px 0}
.dsh-dup-list>li.has-why{flex-wrap:wrap}
.dsh-dup-why{flex:1 0 100%;box-sizing:border-box;margin-top:2px;padding-left:20px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
.dsh-dup-why>summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.dsh-dup-why-text{margin:4px 0 0;padding:6px 8px;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:var(--dsw-radius-sm,4px);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.dsh-dup-hint{margin:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary))}
`;

		/* ================================================================== *
		 * 二、模块状态
		 * ================================================================== */

		let ctxRef = null;
		let disposed = false;
		let styleEl = null;
		let slotEl = null;
		let btnEl = null;
		let observer = null;
		let unsubscribe = null;
		let syncTimer = null;
		let lastSyncAt = 0;
		let retryTimer = null;
		let retryCount = 0;
		/** P6：事件驱动的重载 —— 单槽 timer 把同一窗口里的多个事件合成一次，序号守卫丢弃旧响应。 */
		let reloadTimer = null;
		let reloadSeq = 0;
		let busy = false;
		/** 批量执行中的模式（'disable' | 'enable'），供忙碌态文案取动作词。 */
		let busyMode = null;
		let dialog = null;
		/** 当前弹窗的重画函数：语言一变就用它把弹窗文案整体换成新语言（无弹窗时为 null）。 */
		let dialogRender = null;
		/** locale 服务的退订函数（订阅失败或宿主没有该服务时为 null）。 */
		let localeUnsub = null;

		/**
		 * 最近一次读取到的组合包分类结果。
		 * error 是给用户看的文本、errorKey 是本插件自己那条提示的字典键：
		 * 有 key 时按 key 现取，保证语言切换后显示的是当前语言。
		 */
		let snapshot = { phase: 'loading', targets: [], blocked: [], off: [], error: null, errorKey: null };

		/* ================================================================== *
		 * 三、远程服务访问
		 * ================================================================== */

		/**
		 * 探测远程服务此刻的真实状态：remote 本体、pluginManager 命名空间。
		 *
		 * 关键：`remote` 的命名空间**不是** `remote` 服务对象上的属性，而是各自独立的
		 * cordis 服务，服务名形如 `remote.<namespace>`。依据 api-gateway 客户端半
		 * （lib/client.js 第 2040 行）：
		 *   function remoteServiceKey(namespace) { return `remote.${namespace}`; }
		 * 它自己判重也用 `this.ownerCtx.get(serviceKey)`，并注明「install traced
		 * `remote.<namespace>` services; no JavaScript Proxy」。
		 * 所以 `ctx.get('remote').pluginManager` 恒为 undefined，必须用点分服务名
		 * `ctx.get('remote.pluginManager')`。
		 * 同款第三方先例：dsh-skill-mcp-panel/lib/client.js 用 ctx.get("remote.skillsViewer")。
		 * （官方插件页写 this.ctx.remote.pluginManager 能成立，是因为 cordis 的 `ctx.remote`
		 *   访问器会按点分名继续解析；而 ctx.get('remote') 拿到的只是基础服务本体。）
		 */
		function probeRemote() {
			if (!ctxRef) return { remote: undefined, pm: undefined };
			let remote;
			try {
				remote = ctxRef.get('remote');
			} catch (err) {
				remote = undefined;
			}
			let pm;
			try {
				pm = ctxRef.get('remote.pluginManager');
			} catch (err) {
				pm = undefined;
			}
			if (!pm) {
				// 兜底 1：万一某个外壳把命名空间挂成了基础服务上的属性。
				try {
					pm = remote ? remote.pluginManager : undefined;
				} catch (err) {
					pm = undefined;
				}
			}
			if (!pm) {
				// 兜底 2：cordis 访问器形式（官方插件页的写法 ctx.remote.pluginManager）。
				try {
					pm = ctxRef.remote ? ctxRef.remote.pluginManager : undefined;
				} catch (err) {
					pm = undefined;
				}
			}
			return { remote, pm };
		}

		function pluginManager() {
			return probeRemote().pm;
		}

		/**
		 * 未就绪时按缺在哪一层给出可定位的提示，而不是一句笼统的「不可用」。
		 * 错误对象带上字典键，这样文案在语言切换后重取时仍是当前语言
		 * （快照里的 error 文本是取用当时生成的，重画不会自动更新）。
		 */
		function notReadyError() {
			const { remote, pm } = probeRemote();
			const key = !remote
				? 'error.notReady.remote'
				: !pm
					? 'error.notReady.namespace'
					: 'error.notReady.method';
			const error = new Error(T(key));
			error.dshDupKey = key;
			return error;
		}

		async function fetchBundles() {
			const pm = pluginManager();
			if (!pm || typeof pm.listBundles !== 'function') {
				throw notReadyError();
			}
			const answer = await pm.listBundles();
			if (!answer || answer.ok !== true) throw new Error(remoteErrorText(answer && answer.error, T('error.listBundles')));
			return Array.isArray(answer.value) ? answer.value : [];
		}

		function remoteErrorText(error, fallback) {
			if (!error) return fallback;
			const parts = [];
			if (error.code) parts.push(String(error.code));
			if (error.message) parts.push(String(error.message));
			return parts.length > 0 ? parts.join(T('error.separator')) : fallback;
		}

		/**
		 * 把错误拆成两半：行内只放短标签（错误码），完整诊断留给折叠区。
		 * 理由：诊断可以是一整段 pnpm 输出，塞进行内会把同行元素挤变形。
		 */
		function splitErrorParts(code, detail, fallback) {
			return {
				note: code ? String(code) : fallback,
				detail: detail ? String(detail) : ''
			};
		}

		function remoteErrorParts(error, fallback) {
			if (!error) return { note: fallback, detail: '' };
			return splitErrorParts(error.code, error.message, fallback);
		}

		function changeErrorParts(error, fallback) {
			if (!error) return { note: fallback, detail: '' };
			const extras = [];
			if (error.diagnostic) extras.push(String(error.diagnostic));
			if (Array.isArray(error.incompatible) && error.incompatible.length > 0) {
				const list = error.incompatible.map((item) => {
					if (!item) return T('error.unknown');
					const pkg = item.packageVersion || item.package || item.name || '?';
					const runtime = item.runtimeVersion || item.runtime || '?';
					return T('error.incompatibleItem', { pkg, runtime });
				});
				extras.push(T('error.incompatible', { list: list.join(T('list.separator')) }));
			}
			return splitErrorParts(error.code, extras.join('\n'), fallback);
		}

		/* ================================================================== *
		 * 四、分类：谁算「非官方插件」
		 * ================================================================== */

		/**
		 * 与官方「已安装」分组同口径地筛出非官方组合包，再按可操作性三分：
		 *   targets —— 当前启用且可切换，本次要停用的
		 *   blocked —— 只读项（readOnlyReason），两个方向都切不动，跳过并如实汇报
		 *   off     —— 非官方但已经停用，按钮翻转后要启用的就是这一批
		 * 「非官方」三条同时成立：
		 *   ① 不在 BUILTIN_PROFILE_BUNDLES 中；
		 *   ② 通过官方页 listed / mine 两道过滤（installed || optional || error；installed || !optional）；
		 *   ③ 包名不以 `@deepseek-ai/` 开头，且不是本插件自身。
		 */
		function classify(bundles) {
			const targets = [];
			const blocked = [];
			const off = [];
			for (const bundle of bundles) {
				if (!bundle || typeof bundle.name !== 'string') continue;
				if (BUILTIN_PROFILE_BUNDLES.has(bundle.name)) continue;
				if (!(bundle.installed || bundle.optional || bundle.error !== undefined)) continue;
				if (!(bundle.installed || !bundle.optional)) continue;
				if (bundle.name.startsWith(OFFICIAL_SCOPE)) continue;
				if (bundle.name === SELF) continue;
				// 只读项两个方向都切不动，先归入 blocked，免得被当成可启用目标。
				if (bundle.readOnlyReason) {
					blocked.push(bundle);
					continue;
				}
				if (!bundle.enabled) {
					off.push(bundle);
					continue;
				}
				targets.push(bundle);
			}
			const byName = (a, b) => a.name.localeCompare(b.name);
			targets.sort(byName);
			blocked.sort(byName);
			off.sort(byName);
			return { targets, blocked, off };
		}

		/**
		 * 按钮此刻该干哪件事：
		 *   disable —— 还有可停用的非官方插件，本按钮负责全部停用；
		 *   enable  —— 已没有可停用项、但有已停用的非官方插件，翻转成全部启用；
		 *   none    —— 没有安装非官方插件（或只剩只读项），按钮置灰。
		 */
		function modeOf(parts) {
			if (parts.targets.length > 0) return 'disable';
			if (parts.off.length > 0) return 'enable';
			return 'none';
		}

		async function reload() {
			/* P6：序号守卫。reload 是 async，而 `busy` 只覆盖它自己那次 run()，所以事件、
			 * 重试轮询和 run() 收尾可以同时在飞；先发的旧响应后到，就会用旧快照覆盖新快照
			 * （按钮的文案与可用态随之抖回去）。只有最后一次调用允许写 snapshot。 */
			const seq = (reloadSeq += 1);
			try {
				const bundles = await fetchBundles();
				if (disposed || seq !== reloadSeq) return;
				const parts = classify(bundles);
				snapshot = { phase: 'ready', error: null, errorKey: null, targets: parts.targets, blocked: parts.blocked, off: parts.off };
				stopRetry();
			} catch (err) {
				if (disposed || seq !== reloadSeq) return;
				snapshot = {
					phase: 'error',
					targets: [],
					blocked: [],
					off: [],
					error: err && err.message ? String(err.message) : String(err),
					errorKey: err && err.dshDupKey ? err.dshDupKey : null
				};
				// 绝大多数情况下这里是「命名空间还没挂上来」而非真故障，自动重试直到就绪。
				startRetry();
			}
			render();
		}

		/** 轮询等待 remote.pluginManager 挂载；成功即停，超时即止。 */
		function startRetry() {
			if (disposed || retryTimer !== null || retryCount >= RETRY_MAX) return;
			retryTimer = setTimeout(() => {
				retryTimer = null;
				retryCount += 1;
				if (disposed) return;
				void reload();
			}, RETRY_INTERVAL_MS);
		}

		function stopRetry() {
			if (retryTimer !== null) {
				clearTimeout(retryTimer);
				retryTimer = null;
			}
			retryCount = 0;
		}

		/**
		 * P6：把事件触发的 reload 压成单槽。宿主在批量改动时会连着发
		 * `plugin-manager/changed`，每次都立刻 reload 就是若干个并发 RPC；
		 * 等一个短窗口再读，读到的仍然是最终状态，且只读一次。
		 */
		const RELOAD_DEBOUNCE_MS = 120;
		function scheduleReload() {
			if (disposed || reloadTimer !== null) return;
			reloadTimer = setTimeout(() => {
				reloadTimer = null;
				if (!disposed) void reload();
			}, RELOAD_DEBOUNCE_MS);
		}

		/* ================================================================== *
		 * 五、按钮：注入与状态
		 * ================================================================== */

		function installStyles() {
			if (document.querySelector('style[' + CSS_MARK + ']')) return;
			const style = document.createElement('style');
			style.setAttribute(CSS_MARK, '');
			style.textContent = CSS;
			document.head.appendChild(style);
			styleEl = style;
		}

		function sync() {
			if (disposed) return;
			const group = document.querySelector(GROUP_SELECTOR);
			const head = group ? group.firstElementChild : null;
			if (!head) {
				slotEl = null;
				btnEl = null;
				return;
			}
			if (slotEl && slotEl.isConnected && slotEl.parentElement === head) return;

			for (const stale of head.querySelectorAll(':scope > [' + MARK + ']')) stale.remove();

			const slot = document.createElement('span');
			slot.className = 'dsh-dup-slot';
			slot.setAttribute(MARK, '');
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'dsh-dup-btn';
			button.textContent = T('panel.button.disable');
			button.addEventListener('click', onClick);
			slot.appendChild(button);
			head.appendChild(slot);

			slotEl = slot;
			btnEl = button;
			render();
		}

		function schedule() {
			if (disposed || syncTimer !== null) return;
			const wait = Math.max(0, SYNC_THROTTLE_MS - (Date.now() - lastSyncAt));
			syncTimer = setTimeout(() => {
				syncTimer = null;
				lastSyncAt = Date.now();
				sync();
			}, wait);
		}

		/** P6：先比后写。textContent 每次赋值都是一次 childList 变更，会叫醒本插件自己的
		 * MutationObserver（它观察 body 子树），而按钮文案在多数 render 里根本没变。 */
		function setText(el, text) {
			if (el.textContent !== text) el.textContent = text;
		}

		function render() {
			if (!slotEl || !btnEl || !slotEl.isConnected) return;
			if (busy) {
				btnEl.disabled = true;
				slotEl.title = T('panel.title.busy.' + (busyMode || 'generic'));
				return;
			}
			const { phase, targets, blocked, off, error, errorKey } = snapshot;
			if (phase === 'loading') {
				btnEl.disabled = true;
				setText(btnEl, T('panel.button.disable'));
				slotEl.title = T('panel.title.loading');
				return;
			}
			if (phase === 'error') {
				btnEl.disabled = true;
				setText(btnEl, T('panel.button.disable'));
				const retrying = retryCount > 0 && retryCount < RETRY_MAX;
				slotEl.title =
					(errorKey ? T(errorKey) : error || T('panel.title.error')) +
					(retrying ? T('panel.title.error.retrying', { count: retryCount }) : '');
				return;
			}
			const mode = modeOf(snapshot);
			if (mode === 'none') {
				btnEl.disabled = true;
				setText(btnEl, T('panel.button.disable'));
				slotEl.title =
					blocked.length > 0
						? T('panel.title.none.blocked', { count: blocked.length })
						: T('panel.title.none.empty');
				return;
			}
			btnEl.disabled = false;
			setText(btnEl, T('panel.button.' + mode));
			slotEl.title = T('panel.title.' + mode, {
				count: mode === 'disable' ? targets.length : off.length,
				extra: blocked.length > 0 ? T('panel.title.blockedExtra', { count: blocked.length }) : ''
			});
		}

		async function onClick() {
			if (busy || !btnEl) return;
			btnEl.disabled = true;
			await reload(); // 确认框里的数量必须是点击当下的
			if (disposed) return;
			if (snapshot.phase === 'error') {
				openMessageDialog('error.readList', () =>
					snapshot.errorKey ? T(snapshot.errorKey) : snapshot.error || T('error.unknownError')
				);
				return;
			}
			const mode = modeOf(snapshot);
			if (mode === 'none') {
				render();
				return;
			}
			openConfirmDialog(mode);
		}

		/* ================================================================== *
		 * 六、弹窗骨架
		 * ================================================================== */

		function el(tag, className, text) {
			const node = document.createElement(tag);
			if (className) node.className = className;
			if (text !== undefined) node.textContent = text;
			return node;
		}

		/**
		 * 搭出弹窗骨架。标题 / 正文 / 按钮一律由调用方在 paint 里填：
		 * 语言一变就重跑 paint，整屏文案跟着换，而不用重建弹窗（勾选状态也就保住了）。
		 */
		function mountDialog() {
			closeDialog();
			const previouslyFocused = document.activeElement;

			const root = el('div', 'dsh-dup-modal');
			root.setAttribute(MARK, '');
			const mask = el('div', 'dsh-dup-mask');
			const box = el('div', 'dsh-dup-dialog');
			box.setAttribute('role', 'dialog');
			box.setAttribute('aria-modal', 'true');

			const head = el('div', 'dsh-dup-head');
			const title = el('h2', 'dsh-dup-title');
			const closeBtn = el('button', 'dsh-dup-close');
			closeBtn.type = 'button';
			closeBtn.setAttribute('aria-label', T('close'));
			closeBtn.innerHTML = CLOSE_ICON;
			head.append(title, closeBtn);

			const desc = el('p', 'dsh-dup-desc');
			const body = el('div', 'dsh-dup-body');
			const foot = el('div', 'dsh-dup-foot');
			desc.hidden = true;
			body.hidden = true;
			foot.hidden = true;

			box.append(head, desc, body, foot);
			root.append(mask, box);
			document.body.appendChild(root);

			let dismissible = true;

			const api = {
				root,
				box,
				setTitle(text) {
					title.textContent = text;
				},
				/** ✕ 的 aria-label 也要跟着语言走，所以同样放进 paint 里重设。 */
				setCloseLabel(text) {
					closeBtn.setAttribute('aria-label', text);
				},
				setDescription(text) {
					desc.textContent = text || '';
					desc.hidden = !text;
				},
				setBody(...nodes) {
					body.replaceChildren(...nodes.filter(Boolean));
					body.hidden = body.childElementCount === 0;
				},
				setFooter(...nodes) {
					foot.replaceChildren(...nodes.filter(Boolean));
					foot.hidden = foot.childElementCount === 0;
				},
				/** 运行中把弹窗锁成不可关闭，避免中途 Esc / 点遮罩把进度界面弄丢。 */
				lock() {
					dismissible = false;
					closeBtn.disabled = true;
				},
				unlock() {
					dismissible = true;
					closeBtn.disabled = false;
				},
				requestClose() {
					if (dismissible) closeDialog();
				}
			};

			const dismiss = () => api.requestClose();
			closeBtn.addEventListener('click', dismiss);
			mask.addEventListener('mousedown', (event) => {
				if (event.target === mask) dismiss();
			});
			const onEscape = (event) => {
				if (event.key === 'Escape') {
					event.stopPropagation();
					dismiss();
				}
			};
			document.addEventListener('keydown', onEscape, true);

			dialog = {
				api,
				previouslyFocused,
				onEscape,
				focusFirst() {
					const target =
						foot.querySelector('.dsh-dup-action.is-primary:not(:disabled)') ||
						foot.querySelector('.dsh-dup-action:not(:disabled)') ||
						closeBtn;
					if (target && typeof target.focus === 'function') target.focus();
				}
			};
			return api;
		}

		function closeDialog() {
			// 弹窗一关，语言切换就不必再重画它了。
			dialogRender = null;
			if (!dialog) return;
			document.removeEventListener('keydown', dialog.onEscape, true);
			dialog.api.root.remove();
			const previous = dialog.previouslyFocused;
			dialog = null;
			if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
		}

		/* ================================================================== *
		 * 七、弹窗内容
		 * ================================================================== */

		function actionButton(label, variant, onClick) {
			const button = el('button', 'dsh-dup-action ' + variant, label);
			button.type = 'button';
			button.addEventListener('click', onClick);
			return button;
		}

		/** 行内只留错误码，完整诊断收进这个折叠区（默认收起）。 */
		function whyNode(text) {
			const why = el('details', 'dsh-dup-why');
			why.appendChild(el('summary', undefined, T('dialog.diagnostics')));
			why.appendChild(el('pre', 'dsh-dup-why-text', text));
			return why;
		}

		/**
		 * 结果清单。mode（'disable' | 'enable'）用来选状态文案里的动作词。
		 * 说明文字的取法，优先级从高到低：
		 *   ① noteKey —— 本次执行写入的内置说明，现取字典，语言切换后跟着换；
		 *   ② note    —— 宿主的错误码 / 诊断等原始数据，原样显示、不翻译；
		 *   ③ 状态兜底 —— 例如「已停用」「等待中」。
		 */
		function nameList(entries, mode) {
			const list = el('ul', 'dsh-dup-list');
			for (const entry of entries) {
				const meta = STATUS[entry.status] || STATUS.pending;
				const item = el('li');
				item.appendChild(el('span', 'dsh-dup-mark is-' + meta.tone, meta.mark));
				item.appendChild(el('span', 'dsh-dup-name', entry.name));
				let note;
				if (entry.noteKey) note = T(entry.noteKey);
				else if (entry.note !== undefined && entry.note !== '') note = entry.note;
				else note = T(meta.key(mode));
				if (note) {
					const tone = meta.tone === 'error' ? ' is-error' : meta.tone === 'warn' ? ' is-warn' : '';
					item.appendChild(el('span', 'dsh-dup-note' + tone, note));
				}
				if (entry.detail) {
					// 完整诊断另起一行收进折叠区：它可能是一整段 pnpm 输出，
					// 留在行内会把同一行的包名挤变形。
					item.className = 'has-why';
					item.appendChild(whyNode(entry.detail));
				}
				list.appendChild(item);
			}
			return list;
		}

		/**
		 * 勾选清单：默认全选，行内是「勾选框 + 包名」。
		 * 返回 picks 让调用方拿到每个勾选框对象——状态只活在 DOM 上，
		 * 不额外维护一份 JS 副本，避免两边不同步。
		 */
		function pickList(entries) {
			const list = el('ul', 'dsh-dup-list');
			const picks = [];
			for (const bundle of entries) {
				const item = el('li');
				const label = el('label', 'dsh-dup-pick');
				const box = document.createElement('input');
				box.type = 'checkbox';
				box.className = 'dsh-dup-box';
				box.checked = true;
				label.append(box, el('span', 'dsh-dup-name', bundle.name));
				item.appendChild(label);
				list.appendChild(item);
				picks.push({ name: bundle.name, bundle, box });
			}
			return { list, picks };
		}

		function sect(titleText, ...nodes) {
			const wrap = el('div', 'dsh-dup-sect');
			wrap.appendChild(el('h3', 'dsh-dup-sect-title', titleText));
			for (const node of nodes) if (node) wrap.appendChild(node);
			return wrap;
		}

		/**
		 * 通用信息框。标题走字典键；正文用函数现取 —— 宿主错误原文是数据，
		 * 但我们自己那半句提示（如「插件管理服务未就绪…」）要能跟着语言换。
		 */
		function openMessageDialog(titleKey, resolveMessage) {
			const api = mountDialog();
			const paint = () => {
				api.setCloseLabel(T('close'));
				api.setTitle(T(titleKey));
				api.setDescription(resolveMessage());
				api.setFooter(actionButton(T('close'), 'is-primary', () => closeDialog()));
			};
			paint();
			dialogRender = paint;
			dialog.focusFirst();
		}

		/**
		 * 确认框：勾选清单 + 全选 / 全不选 + 主按钮。
		 * 全部文案都在 paint 里现取，所以弹窗开着时切换语言会就地换过来；
		 * 勾选状态只活在 DOM 上，重画不会碰它。
		 */
		function openConfirmDialog(mode) {
			const spec = MODE[mode];
			const entries = spec.enable ? snapshot.off.slice() : snapshot.targets.slice();
			const blocked = snapshot.blocked.slice();
			/* P6：Set 去重（原来对每个元素在数组里 indexOf 一次 = O(n²)），保留首次出现的顺序。 */
			const reasons = [...new Set(blocked.map((bundle) => bundle.readOnlyReason))]
				.join(T('list.separator'));
			const api = mountDialog();

			const { list, picks } = pickList(entries);

			const countEl = el('span', 'dsh-dup-count');
			const allBtn = el('button', 'dsh-dup-link');
			const noneBtn = el('button', 'dsh-dup-link');
			allBtn.type = 'button';
			noneBtn.type = 'button';
			const tools = el('div', 'dsh-dup-tools');
			tools.append(countEl, allBtn, noneBtn);

			const blockedEl = blocked.length > 0 ? el('p', 'dsh-dup-hint') : null;
			const selfEl = el('p', 'dsh-dup-hint');
			api.setBody(tools, list, blockedEl, selfEl);

			const primary = el('button', 'dsh-dup-action is-primary');
			primary.type = 'button';
			const cancel = actionButton(T('cancel'), 'is-outline', () => closeDialog());

			const syncFoot = () => {
				const chosen = picks.filter((pick) => pick.box.checked).length;
				primary.textContent = T('dialog.primary.' + mode, { count: chosen });
				primary.disabled = chosen === 0;
				countEl.textContent = T('dialog.count', { chosen, total: picks.length });
			};

			const paint = () => {
				api.setCloseLabel(T('close'));
				api.setTitle(T('dialog.title.' + mode));
				api.setDescription(T('dialog.desc.' + mode));
				allBtn.textContent = T('dialog.selectAll');
				noneBtn.textContent = T('dialog.selectNone');
				if (blockedEl) blockedEl.textContent = T('dialog.blocked.' + mode, { count: blocked.length, reasons });
				selfEl.textContent = T('dialog.self.' + mode, { self: SELF });
				cancel.textContent = T('cancel');
				syncFoot();
			};

			primary.addEventListener('click', () => {
				const chosen = picks.filter((pick) => pick.box.checked).map((pick) => pick.bundle);
				if (chosen.length === 0) return;
				void run(chosen, blocked, mode);
			});
			// 逐个勾选框挂监听，不做事件委托：验证台的迷你 DOM 没有冒泡。
			for (const pick of picks) pick.box.addEventListener('change', syncFoot);
			allBtn.addEventListener('click', () => {
				for (const pick of picks) pick.box.checked = true;
				syncFoot();
			});
			noneBtn.addEventListener('click', () => {
				for (const pick of picks) pick.box.checked = false;
				syncFoot();
			});

			api.setFooter(cancel, primary);
			paint();
			dialogRender = paint;
			dialog.focusFirst();
		}

		/* ================================================================== *
		 * 八、批量切换（停用 / 启用）
		 * ================================================================== */

		async function run(targets, blocked, mode) {
			if (busy || !dialog) return;
			const spec = MODE[mode];
			busy = true;
			busyMode = mode;
			const api = dialog.api;
			api.lock();
			render();

			const items = targets.map((bundle) => ({
				name: bundle.name,
				status: 'pending',
				/** 宿主给的错误码等原始数据，原样显示。 */
				note: '',
				/** 本插件自己那条说明的字典键，现取现翻（语言切换后仍对）。 */
				noteKey: null,
				detail: ''
			}));
			/** 进度记在闭包里，语言切换重画时按同一个进度重取文案。 */
			let progress = 0;
			let lastBodyAt = 0;
			/* P6：正文是整张清单（n 项），每完成一项就重画一次 = O(n²) 的 DOM 构建。
			 * 进度文字仍然每次都更新，正文按墙钟节流到 ~80ms 一次；最后一项与语言切换必画。 */
			const BODY_REDRAW_MS = 80;
			const draw = (done, force) => {
				if (disposed) return;
				progress = done;
				api.setTitle(T('run.title.' + mode));
				api.setDescription(T('run.desc.' + mode, { done, total: items.length }));
				const now = Date.now();
				if (force === true || now - lastBodyAt >= BODY_REDRAW_MS) {
					lastBodyAt = now;
					api.setBody(nameList(items, mode));
				}
				api.setFooter();
			};
			draw(0, true);
			dialogRender = () => draw(progress, true);

			const pm = pluginManager();
			for (let index = 0; index < items.length; index += 1) {
				if (disposed) break;
				const item = items[index];
				try {
					// 串行执行：setBundleEnabled 要写 profile 文件，并发会互相竞争。
					const answer = pm ? await pm.setBundleEnabled(item.name, spec.enable) : undefined;
					if (!answer || answer.ok !== true) {
						item.status = 'failed';
						const parts = remoteErrorParts(answer && answer.error, '');
						if (parts.note) item.note = parts.note;
						else item.noteKey = 'run.note.callFailed';
						item.detail = parts.detail;
					} else {
						const result = answer.value || {};
						switch (result.application) {
							case 'failed': {
								item.status = 'failed';
								const parts = changeErrorParts(result.error, '');
								if (parts.note) item.note = parts.note;
								else item.noteKey = 'run.note.verbFailed.' + mode;
								item.detail = parts.detail;
								break;
							}
							case 'cancelled':
								item.status = 'cancelled';
								item.noteKey = 'run.note.cancelled';
								break;
							case 'overridden':
								item.status = 'overridden';
								item.noteKey = 'run.note.overridden';
								break;
							case 'restart-required':
								item.status = 'restart';
								item.noteKey = 'run.note.restart';
								break;
							default:
								item.status = 'applied';
								item.note = '';
								break;
						}
					}
				} catch (err) {
					// 单项失败绝不中断循环，其余插件继续处理。
					item.status = 'failed';
					item.noteKey = 'run.note.exception';
					item.detail = err && err.message ? String(err.message) : String(err);
				}
				draw(index + 1, index === items.length - 1);
			}

			busy = false;
			busyMode = null;
			await reload(); // 刷新按钮自身的可用状态（全部停用后这里会翻成启用侧）
			renderResult(items, blocked, mode);
		}

		function renderResult(items, blocked, mode) {
			if (!dialog) return;
			const succeeded = items.filter((item) => item.status === 'applied' || item.status === 'restart');
			const restarted = items.filter((item) => item.status === 'restart');
			const failed = items.filter(
				(item) => item.status === 'failed' || item.status === 'overridden' || item.status === 'cancelled'
			);

			dialog.api.setCloseLabel(T('close'));
			dialog.api.setTitle(T(failed.length === 0 ? 'result.title.done.' + mode : 'result.title.partial.' + mode));
			let summary = T('result.summary.success.' + mode, { count: succeeded.length });
			if (failed.length > 0) summary += T('result.summary.failed', { count: failed.length });
			if (blocked.length > 0) summary += T('result.summary.skipped', { count: blocked.length });
			summary += T('result.summary.end');
			if (restarted.length > 0) summary += T('result.summary.restart', { count: restarted.length });
			dialog.api.setDescription(summary);

			const nodes = [];
			if (failed.length > 0) {
				nodes.push(sect(T('result.sect.failed', { count: failed.length }), nameList(failed, mode)));
			}
			if (blocked.length > 0) {
				nodes.push(
					sect(
						T('result.sect.skipped', { count: blocked.length }),
						nameList(
							blocked.map((bundle) => ({
								name: bundle.name,
								status: 'skipped',
								note: T('result.note.readonly', { reason: bundle.readOnlyReason })
							})),
							mode
						)
					)
				);
			}
			if (succeeded.length > 0) {
				const details = el('details', 'dsh-dup-details');
				details.appendChild(el('summary', undefined, T('result.details.' + mode, { count: succeeded.length })));
				details.appendChild(nameList(succeeded, mode));
				nodes.push(details);
			}
			if (nodes.length === 0) nodes.push(el('p', 'dsh-dup-hint', T('result.empty')));
			dialog.api.setBody(...nodes);
			dialog.api.unlock();
			dialog.api.setFooter(actionButton(T('close'), 'is-primary', () => closeDialog()));
			// 结果框同样登记重画：摘要、分区标题、每行状态说明一起换语言。
			dialogRender = () => renderResult(items, blocked, mode);
			dialog.focusFirst();
		}

		/* ================================================================== *
		 * 九、生命周期
		 * ================================================================== */

		/** 语言一变：按钮与 tooltip 重画，当前弹窗（若有）也按新语言重画一遍。 */
		function redrawForLocale() {
			render();
			if (!dialogRender) return;
			try {
				dialogRender();
			} catch (err) {
				/* 重画失败不该让语言切换本身出错 */
			}
		}

		/**
		 * 接上宿主的语言服务（@deepseek-ai/dsh-client-locale）：注册中英字典 →
		 * 取翻译器 → 订阅语言变化。任何一步失败都只退回兜底文案，
		 * 绝不能让按钮整个不出来。
		 */
		function bindLocale(ctx) {
			let locale;
			try {
				locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined;
			} catch (err) {
				locale = undefined;
			}
			if (!locale || typeof locale.bind !== 'function') return;
			translate = locale.bind(NS);
			if (typeof locale.register === 'function') {
				try {
					const register = () => locale.register(NS, DICT);
					if (typeof ctx.effect === 'function') {
						ctx.effect(register, 'disable-unofficial-plugins: dictionaries');
					} else {
						register();
					}
				} catch (err) {
					// 同一实例被重复注入时命名空间已存在，沿用先注册的那套即可。
				}
			}
			if (typeof locale.subscribe === 'function') {
				try {
					const off = locale.subscribe(redrawForLocale);
					if (typeof off === 'function') localeUnsub = off;
				} catch (err) {
					/* 订阅失败不影响按钮本身 */
				}
			}
		}

		function dispose() {
			disposed = true;
			busyMode = null;
			if (syncTimer !== null) {
				clearTimeout(syncTimer);
				syncTimer = null;
			}
			stopRetry();
			if (observer) {
				observer.disconnect();
				observer = null;
			}
			if (reloadTimer !== null) {
				clearTimeout(reloadTimer);
				reloadTimer = null;
			}
			if (typeof unsubscribe === 'function') {
				try {
					unsubscribe();
				} catch (err) {
					/* 退订失败无需上报 */
				}
				unsubscribe = null;
			}
			if (typeof localeUnsub === 'function') {
				try {
					localeUnsub();
				} catch (err) {
					/* 退订失败无需上报 */
				}
			}
			localeUnsub = null;
			closeDialog();
			if (slotEl) {
				slotEl.remove();
				slotEl = null;
			}
			btnEl = null;
			if (styleEl) {
				styleEl.remove();
				styleEl = null;
			}
		}

		function apply(ctx) {
			disposed = false;
			ctxRef = ctx;
			installStyles();
			// 语言服务要最先接上：字典得在任何一条文案落地之前注册好。
			bindLocale(ctx);

			if (typeof ctx.effect === 'function') ctx.effect(() => dispose);

			const remote = ctx.get('remote');
			if (remote && typeof remote.$on === 'function') {
				try {
					const off = remote.$on('plugin-manager/changed', () => {
						if (!busy) scheduleReload();
					});
					if (typeof off === 'function') unsubscribe = off;
				} catch (err) {
					/* 订阅失败不影响按钮本身 */
				}
			}

			observer = new MutationObserver(schedule);
			observer.observe(document.body, { childList: true, subtree: true });

			sync();
			void reload();
		}

		// `locale` 是服务门控：它在宿主上就绪后 apply 才跑，文案因此一定拿到当前语言；
		// bindLocale 里仍留了兜底，万一某个外壳没有这个服务，就退回按浏览器语言判断。
		return { name: SELF, apply, inject: ['remote', 'locale'] };
	}
});
