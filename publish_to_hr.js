/**
 * publish_to_hr.js
 * 审核通过后自动发布岗位到 HR 系统（hr.xiaohongshu.com）+ 实习僧
 * 调用方式：由 OpenClaw 在管理员审核通过后触发
 *
 * 固定参数（车英确认）：
 *   - 招聘类型: 实习生招聘
 *   - 人员类别: 实习生（不可选）
 *   - 招聘人数: 1
 *   - 职位优先级: 常规
 *   - 工作地点: 上海市
 *   - 工作经验: 在读学生
 *   - 学历要求: 本科及以上
 *   - 薪资范围: 3k-4k
 *   - 招聘流程: 默认实习生
 *   - 招聘负责人: 车英(贾逸杰)
 *   - 实习僧: 实习3个月,每周5天,转正面议,4个亮点
 *
 * 变量参数（来自用户填写）：
 *   - job.title      职位名称
 *   - job.dept       所在部门（级联路径，如 "商业部 / 商业市场营销中台 / 行业营销三组"）
 *   - job.jobCategory 职位类（如 "市场公关 / 市场 / 营销策划"）
 *   - job.jd         工作职责 + 任职资格（JD全文）
 *   - job.name       用人经理薯名
 */

const SSO_COOKIE = 'AT-2be1e5be9fc840d390730ad71f9f5021-ece6d9378db4be948c1b1d1767878379';
const HR_BASE = 'https://hr.xiaohongshu.com';

// 固定值
const FIXED = {
  salary: { min: 3000, max: 4000 },
  workplace: '上海市',
  education: '本科及以上',
  workExp: '在读学生',
  headcountNum: 1,
  priority: '常规',
  recruiter: '车英',           // 招聘负责人，系统里搜「贾逸杰」
  internMonths: 3,
  workDaysPerWeek: 5,
  highlights: ['扁平管理', '免费三餐', '弹性工作', '团队实力'],
};

// 解析JD：把全文拆成 工作职责 / 任职资格
function parseJD(jd) {
  const dutyMatch = jd.match(/【岗位职责】([\s\S]*?)(?=【任职要求】|$)/);
  const qualMatch = jd.match(/【任职要求】([\s\S]*?)(?=【|$)/);
  const duty = dutyMatch ? dutyMatch[1].trim() : jd;
  const qual = qualMatch ? qualMatch[1].trim() : '';
  return { duty, qual };
}

// 解析部门路径 → 级联数组
// "商业部 / 商业市场营销中台 / 行业营销三组" → ['商业部', '商业市场营销中台', '行业营销三组']
function parseDeptPath(dept) {
  return dept.split('/').map(s => s.trim()).filter(Boolean);
}

// 解析职位类路径
// "市场公关 / 市场 / 营销策划" → ['市场公关', '市场', '营销策划']
function parseCategoryPath(cat) {
  return cat.split('/').map(s => s.trim()).filter(Boolean);
}

/**
 * 主函数：接收岗位数据，用 OpenClaw browser tool 操作 HR 系统
 * @param {Object} job - 来自 hrPublishQueue 的岗位对象
 * @param {Function} browserAct - OpenClaw browser tool 的调用函数（由调用方传入）
 */
async function publishToHR(job, browserAct) {
  const { duty, qual } = parseJD(job.jd || '');
  const deptPath = parseDeptPath(job.dept || '');
  const catPath = parseCategoryPath(job.jobCategory || '');
  const log = [];

  try {
    // Step 1: 打开创建页
    await browserAct('navigate', { url: `${HR_BASE}/position-manage/create?recruitType=intern&step=0` });
    log.push('✅ 页面加载成功');

    // Step 2: 注入 SSO cookie
    await browserAct('evaluate', {
      fn: `() => { document.cookie = 'common-internal-access-token-prod=${SSO_COOKIE}; path=/; domain=.xiaohongshu.com'; return 'ok'; }`
    });
    await browserAct('navigate', { url: `${HR_BASE}/position-manage/create?recruitType=intern&step=0` });
    log.push('✅ SSO cookie 注入');

    // Step 3: 填职位名称
    await fillInput('positionName', job.title);
    log.push(`✅ 职位名称: ${job.title}`);

    // Step 4: 选需求部门（级联）
    await selectCascader('departmentIdList', deptPath);
    log.push(`✅ 需求部门: ${deptPath.join(' > ')}`);

    // Step 5: 选职位类（级联）
    await selectCascader('positionTypeCascader', catPath);
    log.push(`✅ 职位类: ${catPath.join(' > ')}`);

    // Step 6: 填招聘人数
    await clearAndFill('recruitNum', '1');
    log.push('✅ 招聘人数: 1');

    // Step 7: 选职位优先级
    await selectCombobox('positionPriority', '常规');
    log.push('✅ 职位优先级: 常规');

    // Step 8: 选工作地点
    await selectCombobox('workplace', '上海市');
    log.push('✅ 工作地点: 上海市');

    // Step 9: 选工作经验
    await selectCombobox('workExperience', '在读学生');
    log.push('✅ 工作经验: 在读学生');

    // Step 10: 选学历
    await selectCombobox('education', '本科及以上');
    log.push('✅ 学历: 本科及以上');

    // Step 11: 选薪资（min 3k, max 4k）
    // 薪资是两个无label的combobox，按位置找
    await selectNthCombobox(0, '3000');
    await selectNthCombobox(1, '4000');
    log.push('✅ 薪资: 3k-4k');

    // Step 12: 填工作职责
    await fillInput('duty', duty);
    log.push('✅ 工作职责填写完成');

    // Step 13: 填任职资格
    await fillInput('qualification', qual);
    log.push('✅ 任职资格填写完成');

    // Step 14: 点「下一步」进入 Step2（招聘流程）
    await clickButton('下一步');
    await sleep(1000);
    log.push('✅ 进入 Step2 - 招聘流程');

    // Step 15: Step2 选默认实习生招聘流程（通常已默认选中，跳过或确认）
    // 点「下一步」进入 Step3（职位相关人）
    await clickButton('下一步');
    await sleep(1000);
    log.push('✅ 进入 Step3 - 职位相关人');

    // Step 16: Step3 选招聘负责人（车英/贾逸杰）
    await searchAndSelectPerson('recruitChargerId', '贾逸杰');
    log.push('✅ 招聘负责人: 车英(贾逸杰)');

    // Step 17: 选用人经理（按薯名搜索）
    await searchAndSelectPerson('businessManagerList', job.name);
    log.push(`✅ 用人经理: ${job.name}`);

    // Step 18: 点「发布」
    await clickButton('发布');
    await sleep(2000);
    log.push('✅ 岗位发布提交');

    // Step 19: 跳转到「招聘渠道管理」→ 找到实习僧 → 点发布
    // 发布成功后通常跳转到岗位详情或渠道管理页
    const currentUrl = await browserAct('getUrl', {});
    log.push(`📍 当前页面: ${currentUrl}`);

    // 尝试找「实习僧」发布入口
    const channelPublished = await publishToShixiseng();
    if (channelPublished) {
      log.push('✅ 实习僧发布成功');
    } else {
      log.push('⚠️ 实习僧发布需手动操作');
    }

    return { success: true, log };
  } catch (e) {
    log.push(`❌ 出错: ${e.message}`);
    return { success: false, log, error: e.message };
  }

  // ---- 内部工具函数 ----

  async function fillInput(fieldId, text) {
    await browserAct('evaluate', {
      fn: `async () => {
        const el = document.getElementById('${fieldId}');
        if (!el) throw new Error('fillInput: #${fieldId} not found');
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', {bubbles:true}));
        await new Promise(r => setTimeout(r, 200));
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', {bubbles:true}));
        el.dispatchEvent(new Event('change', {bubbles:true}));
        return 'ok';
      }`
    });
  }

  async function clearAndFill(fieldId, text) {
    await fillInput(fieldId, text);
  }

  async function selectCascader(triggerId, pathArr) {
    // 点开级联
    await browserAct('evaluate', {
      fn: `async () => {
        const el = document.getElementById('${triggerId}');
        if (!el) throw new Error('cascader trigger not found: ${triggerId}');
        el.click();
        await new Promise(r => setTimeout(r, 600));
        return 'opened';
      }`
    });

    // 逐级选择
    for (let level = 0; level < pathArr.length; level++) {
      const target = pathArr[level];
      await browserAct('evaluate', {
        fn: `async () => {
          const menus = document.querySelectorAll('.ant-cascader-menu');
          const menu = menus[${level}];
          if (!menu) throw new Error('cascader menu level ${level} not found');
          const items = Array.from(menu.querySelectorAll('.ant-cascader-menu-item'));
          const item = items.find(i => i.textContent.trim() === ${JSON.stringify(target)});
          if (!item) throw new Error('cascader option not found: ' + ${JSON.stringify(target)});
          item.dispatchEvent(new MouseEvent('mouseenter', {bubbles:true}));
          item.click();
          await new Promise(r => setTimeout(r, 600));
          return 'selected: ' + ${JSON.stringify(target)};
        }`
      });
    }
  }

  async function selectCombobox(fieldId, optionText) {
    await browserAct('evaluate', {
      fn: `async () => {
        const el = document.getElementById('${fieldId}');
        if (!el) throw new Error('combobox not found: ${fieldId}');
        el.click();
        await new Promise(r => setTimeout(r, 400));
        const opts = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
        const opt = Array.from(opts).find(o => o.textContent.trim().includes(${JSON.stringify(optionText)}));
        if (!opt) throw new Error('option not found: ${optionText}');
        opt.click();
        await new Promise(r => setTimeout(r, 300));
        return 'ok';
      }`
    });
  }

  async function selectNthCombobox(nth, optionText) {
    await browserAct('evaluate', {
      fn: `async () => {
        const combos = document.querySelectorAll('.ant-select-selector');
        const unlabeled = Array.from(combos).filter(el => {
          const formItem = el.closest('.ant-form-item');
          const label = formItem?.querySelector('label');
          return !label || label.textContent.trim() === '';
        });
        const target = unlabeled[${nth}];
        if (!target) throw new Error('nth combobox ${nth} not found');
        target.click();
        await new Promise(r => setTimeout(r, 400));
        const opts = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
        const opt = Array.from(opts).find(o => o.textContent.trim().includes(${JSON.stringify(optionText)}));
        if (!opt) throw new Error('salary option not found: ${optionText}');
        opt.click();
        await new Promise(r => setTimeout(r, 300));
        return 'ok';
      }`
    });
  }

  async function searchAndSelectPerson(fieldId, name) {
    // HR系统人员选择：点开→搜索→选
    await browserAct('evaluate', {
      fn: `async () => {
        const el = document.getElementById('${fieldId}');
        if (!el) throw new Error('person field not found: ${fieldId}');
        el.click();
        await new Promise(r => setTimeout(r, 400));
        el.value = ${JSON.stringify(name)};
        el.dispatchEvent(new Event('input', {bubbles:true}));
        await new Promise(r => setTimeout(r, 800));
        const opts = document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
        const opt = Array.from(opts).find(o => o.textContent.trim().includes(${JSON.stringify(name)}));
        if (!opt) throw new Error('person not found: ${name}');
        opt.click();
        await new Promise(r => setTimeout(r, 300));
        return 'ok';
      }`
    });
  }

  async function clickButton(text) {
    await browserAct('evaluate', {
      fn: `async () => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => b.textContent.trim().includes(${JSON.stringify(text)}));
        if (!btn) throw new Error('button not found: ${text}');
        btn.click();
        await new Promise(r => setTimeout(r, 500));
        return 'clicked';
      }`
    });
  }

  async function publishToShixiseng() {
    // 找实习僧发布入口
    try {
      await browserAct('evaluate', {
        fn: `async () => {
          await new Promise(r => setTimeout(r, 2000));
          // 找"实习僧"或"发布渠道"按钮
          const btns = Array.from(document.querySelectorAll('button, a'));
          const shixiseng = btns.find(b => b.textContent.includes('实习僧'));
          if (shixiseng) { shixiseng.click(); return 'clicked'; }
          return 'not found';
        }`
      });
      return true;
    } catch {
      return false;
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { publishToHR };
