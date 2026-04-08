/**
 * publish_to_hr.mjs
 * 审核通过后自动发布岗位到 HR 系统 + 实习僧
 * 用法: node publish_to_hr.mjs '<job_json>'
 */

// job 结构:
// { title, dept, jobCategory, jd, name, jobId }
// dept 格式: "商业部 / 商业市场营销中台 / 行业营销三组"
// jobCategory 格式: "市场公关 / 市场 / 营销策划"

import { chromium } from 'playwright';

const SSO_COOKIE = 'AT-2be1e5be9fc840d390730ad71f9f5021-ece6d9378db4be948c1b1d1767878379';

// 职位类 -> 在HR系统里的路径（固定映射）
// 格式: [L3(职位类大类), L4(子类), L5(细类)]
const CATEGORY_MAP = {
  '营销策划':   ['市场公关', '市场', '营销策划'],
  '品牌管理':   ['市场公关', '市场', '营销策划'],
  '市场运营':   ['市场公关', '市场', '营销策划'],
  '公关传播':   ['市场公关', '公关', '公关传播'],
  '活动策划':   ['市场公关', '公关', '公关传播'],
  '电商运营':   ['运营', '运营', '电商运营'],
  '内容运营':   ['运营', '运营', '内容运营'],
  '用户运营':   ['运营', '运营', '用户运营'],
  '商家运营':   ['运营', '运营', '电商运营'],
  '项目管理':   ['运营', '运营', '项目管理'],
  '商业分析':   ['商业', '商业', '商业'],
  '商务拓展':   ['商业', '商业', '商业'],
  '广告销售':   ['商业', '商业', '商业'],
  '产品经理':   ['产品', '产品', '产品'],
  '后端开发':   ['技术', '技术', '研发'],
  '前端开发':   ['技术', '技术', '研发'],
  '算法/数据':  ['技术', '技术', '研发'],
  '财务分析':   ['职能', '职能', '财务'],
  '人力资源':   ['职能', '职能', '职能'],
  '法务合规':   ['职能', '职能', '职能'],
  '行政综合':   ['职能', '职能', '职能'],
};

function parseJD(jd) {
  const dutyMatch = jd.match(/【岗位职责】([\s\S]*?)(?=【任职要求】|$)/);
  const qualMatch = jd.match(/【任职要求】([\s\S]*?)(?=【实习信息】|【|$)/);
  const duty = dutyMatch ? dutyMatch[1].trim() : jd.substring(0, Math.floor(jd.length / 2));
  const qual = qualMatch ? qualMatch[1].trim() : jd.substring(Math.floor(jd.length / 2));
  return { duty, qual };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function reactSet(page, selector, value) {
  await page.evaluate(({ sel, val }) => {
    const inp = typeof sel === 'string'
      ? document.querySelector(sel)
      : sel;
    if (!inp) throw new Error('input not found: ' + sel);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, val);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function clickAntSelect(page, fieldId, optionText) {
  await page.evaluate(async ({ fid, optText }) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    const el = document.getElementById(fid);
    if (!el) throw new Error('field not found: ' + fid);
    const rc = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rc.left + 5, clientY: rc.top + 5 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rc.left + 5, clientY: rc.top + 5 }));
    await sleep(600);
    const opts = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
    const opt = Array.from(opts).find(o => o.textContent.trim().includes(optText));
    if (!opt) throw new Error('option not found: ' + optText + ' in ' + Array.from(opts).map(o => o.textContent.trim()).join(','));
    opt.click();
    await sleep(300);
  }, { fid: fieldId, optText: optionText });
}

async function selectCascader(page, triggerId, pathArr) {
  // 打开级联
  await page.evaluate(async (fid) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    const el = document.getElementById(fid);
    el.click();
    await sleep(600);
  }, triggerId);

  for (let level = 0; level < pathArr.length; level++) {
    const target = pathArr[level];
    await page.evaluate(async ({ lvl, text }) => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      const menus = document.querySelectorAll('.ant-cascader-menu');
      const menu = menus[lvl];
      if (!menu) throw new Error('menu level ' + lvl + ' not found');
      const items = Array.from(menu.querySelectorAll('.ant-cascader-menu-item'));
      const item = items.find(i => i.textContent.trim() === text);
      if (!item) throw new Error('option not found at L' + lvl + ': ' + text + ', opts: ' + items.map(i => i.textContent.trim()).join(','));
      item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      item.click();
      await sleep(600);
    }, { lvl: level, text: target });
  }
}

async function searchAndSelectPerson(page, labelText, name) {
  await page.evaluate(async ({ lbl, nm }) => {
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    const labels = document.querySelectorAll('.ant-form-item-label label');
    const l = Array.from(labels).find(x => x.textContent.trim().includes(lbl));
    if (!l) throw new Error('label not found: ' + lbl);
    const formItem = l.closest('.ant-form-item');
    const sel = formItem.querySelector('.ant-select-selector');
    const rc = sel.getBoundingClientRect();
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rc.left + 5, clientY: rc.top + 5 }));
    sel.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rc.left + 5, clientY: rc.top + 5 }));
    await sleep(400);
    const input = formItem.querySelector('input.ant-select-selection-search-input');
    if (input) {
      input.value = nm;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(1000);
    const drops = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
    const opt = Array.from(drops).find(o => o.textContent.includes(nm));
    if (!opt) throw new Error('person not found: ' + nm + ', opts: ' + Array.from(drops).slice(0, 5).map(o => o.textContent.trim()).join(','));
    opt.click();
    await sleep(300);
  }, { lbl: labelText, nm: name });
}

export async function publishJob(job) {
  const log = [];
  const browser = await chromium.connectOverCDP('http://localhost:18800');
  const context = browser.contexts()[0];
  const page = context.pages()[0];

  try {
    // 注入 cookie
    await context.addCookies([{
      name: 'common-internal-access-token-prod',
      value: SSO_COOKIE,
      domain: '.xiaohongshu.com',
      path: '/',
    }]);

    // ===== STEP 1: 职位信息 =====
    await page.goto('https://hr.xiaohongshu.com/position-manage/create?recruitType=intern&step=0', { waitUntil: 'networkidle' });
    log.push('✅ HR系统打开');

    // 职位名称
    await page.evaluate(async (title) => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      const el = document.getElementById('positionName');
      el.focus(); el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(100);
      el.value = title;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, job.title);
    log.push(`✅ 职位名称: ${job.title}`);

    // 需求部门（级联）
    const deptPath = job.dept.split('/').map(s => s.trim()).filter(Boolean);
    await selectCascader(page, 'departmentIdList', deptPath);
    log.push(`✅ 需求部门: ${deptPath.join(' > ')}`);

    // 职位类（需求部门选完后第4列是职位类）
    // 重新点开，走完部门路径后选职位类
    const catLeaf = job.jobCategory.split('/').map(s => s.trim()).pop(); // e.g. "营销策划"
    const catPath = CATEGORY_MAP[catLeaf] || ['市场公关', '市场', '营销策划'];
    // 职位类级联需要先走部门路径（前3级）再选第4-6列
    await selectCascader(page, 'positionTypeCascader', [...deptPath, ...catPath]);
    log.push(`✅ 职位类: ${catPath.join(' > ')}`);

    // 招聘人数
    await page.evaluate(() => {
      const el = document.getElementById('recruitNum');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '1');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // 职位优先级 -> 常规
    await clickAntSelect(page, 'positionPriority', '常规');
    log.push('✅ 优先级: 常规');

    // 工作地点 -> 上海市
    await clickAntSelect(page, 'workplace', '上海市');
    // 工作经验 -> 在读学生
    await clickAntSelect(page, 'workExperience', '在读');
    // 学历 -> 本科
    await clickAntSelect(page, 'education', '本科');
    log.push('✅ 地点/经验/学历');

    // 薪资 3k-4k
    await page.evaluate(async () => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      const salaryLabel = Array.from(document.querySelectorAll('.ant-form-item-label label')).find(l => l.textContent.trim() === '薪资范围');
      const formItem = salaryLabel.closest('.ant-form-item');
      const selectors = formItem.querySelectorAll('.ant-select-selector');
      async function pickSalary(selector, optText) {
        const rc = selector.getBoundingClientRect();
        selector.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rc.left + 5, clientY: rc.top + 5 }));
        selector.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rc.left + 5, clientY: rc.top + 5 }));
        await sleep(600);
        const opts = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
        const opt = Array.from(opts).find(o => o.textContent.trim() === optText);
        if (opt) opt.click();
        await sleep(300);
      }
      await pickSalary(selectors[0], '3k');
      await pickSalary(selectors[1], '4k');
    });
    log.push('✅ 薪资: 3k-4k');

    // JD
    const { duty, qual } = parseJD(job.jd || '');
    await page.evaluate(({ d, q }) => {
      const dutyEl = document.getElementById('duty');
      const qualEl = document.getElementById('qualification');
      dutyEl.focus(); dutyEl.value = d;
      dutyEl.dispatchEvent(new Event('input', { bubbles: true }));
      qualEl.focus(); qualEl.value = q;
      qualEl.dispatchEvent(new Event('input', { bubbles: true }));
    }, { d: duty, q: qual });
    log.push('✅ JD填写完成');

    // 下一步 -> Step2
    await page.evaluate(async () => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '下一步');
      btn.click();
      await sleep(1500);
    });
    log.push('✅ 进入Step2');

    // ===== STEP 2: 招聘流程 =====
    await clickAntSelect(page, 'processId', '默认实习生招聘流程');
    log.push('✅ 招聘流程: 默认实习生');

    await page.evaluate(async () => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '下一步');
      btn.click();
      await sleep(1500);
    });
    log.push('✅ 进入Step3');

    // ===== STEP 3: 职位相关人 =====
    // 招聘负责人：贾逸杰
    await searchAndSelectPerson(page, '招聘负责人', '贾逸杰');
    log.push('✅ 招聘负责人: 车英(贾逸杰)');

    // 用人经理：按薯名搜索
    await searchAndSelectPerson(page, '用人经理', job.name);
    log.push(`✅ 用人经理: ${job.name}`);

    // 提交
    await page.evaluate(async () => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().includes('创建职位'));
      btn.click();
      await sleep(2000);
    });

    const finalUrl = page.url();
    const positionIdMatch = finalUrl.match(/\/view\/(\d+)/);
    const positionId = positionIdMatch ? positionIdMatch[1] : null;
    log.push(`✅ 岗位创建成功! HR系统ID: ${positionId}`);

    if (!positionId) throw new Error('提交后未跳转到岗位详情页，可能有校验错误');

    // ===== 实习僧发布 =====
    await page.evaluate(async () => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      // 等待渠道页加载
      await sleep(1000);
      // 找实习僧的 toSettings 按钮（第3个外部渠道）
      const settingsBtns = Array.from(document.querySelectorAll('.button.toSettings'));
      if (settingsBtns.length >= 3) {
        settingsBtns[2].click();
        await sleep(1500);
      }
    });
    log.push('✅ 实习僧设置弹窗打开');

    // 填实习僧必填字段
    await page.evaluate(async () => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      function reactSet(inp, val) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, val);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const monthInp = Array.from(document.querySelectorAll('input')).find(i => i.placeholder === '请输入数字，1~12之间');
      const dayInp = Array.from(document.querySelectorAll('input')).find(i => i.placeholder === '请输入数字，1~7之间');
      const minInp = Array.from(document.querySelectorAll('input')).find(i => i.placeholder === '最低日薪');
      const maxInp = Array.from(document.querySelectorAll('input')).find(i => i.placeholder === '最高日薪');
      if (monthInp) reactSet(monthInp, '3');
      if (dayInp) reactSet(dayInp, '5');
      if (minInp) reactSet(minInp, '150');
      if (maxInp) reactSet(maxInp, '200');
      await sleep(300);
    });

    // 转正机会 -> 面议
    await page.evaluate(async () => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      const labels = document.querySelectorAll('label');
      const l = Array.from(labels).find(x => x.textContent.trim() === '转正机会');
      if (!l) return;
      const formItem = l.closest('.ant-form-item') || l.closest('[class*=form]');
      const sel = formItem?.querySelector('.ant-select-selector');
      if (!sel) return;
      const rc = sel.getBoundingClientRect();
      sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: rc.left + 5, clientY: rc.top + 5 }));
      sel.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rc.left + 5, clientY: rc.top + 5 }));
      await sleep(600);
      const opts = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
      const opt = Array.from(opts).find(o => o.textContent.trim() === '面议');
      if (opt) opt.click();
      await sleep(300);
    });
    log.push('✅ 实习僧信息填写完成');

    // 点发布
    await page.evaluate(async () => {
      function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
      const drawerBtn = document.querySelector('.ant-drawer .button.toSettings, .ant-drawer-body .button');
      if (drawerBtn) { drawerBtn.click(); await sleep(1500); }
    });
    log.push('✅ 实习僧发布成功!');

    return { success: true, positionId, log };

  } catch (e) {
    log.push(`❌ 出错: ${e.message}`);
    return { success: false, log, error: e.message };
  } finally {
    await browser.disconnect();
  }
}

// CLI入口
const jobJson = process.argv[2];
if (jobJson) {
  const job = JSON.parse(jobJson);
  publishJob(job).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}
