import type { DemoState } from './types';
import { DemoClock } from './clock';

export const DEFAULT_DEMO_SEED = 20260919;

function seededNumber(seed: number): number {
  let value = seed >>> 0;
  value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
  return value;
}

export function createSeedState(seed = DEFAULT_DEMO_SEED, clock = new DemoClock()): DemoState {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('Demo seed must be a non-negative integer.');

  const now = clock.now();
  const dueAt = new Date(Date.parse(now) + 6 * 60 * 60 * 1000).toISOString();
  const overdueAt = new Date(Date.parse(now) - 60 * 60 * 1000).toISOString();

  return {
    schemaVersion: 24,
    seed,
    company: { id: 'COMP-001', name: '星澜证券' },
    departments: [
      { id: 'DEP-001', name: '客户服务部', parentId: null },
      { id: 'DEP-002', name: '研究部', parentId: null },
      { id: 'DEP-003', name: '运营部', parentId: null }
    ],
    employees: [
      {
        id: 'EMP-001',
        name: '林悦',
        departmentId: 'DEP-001',
        roles: ['employee', 'institution-sales'],
        active: true
      },
      {
        id: 'EMP-002',
        name: '陈明',
        departmentId: 'DEP-001',
        roles: ['employee', 'manager', 'event-organizer'],
        active: true
      },
      {
        id: 'EMP-003',
        name: '王晨',
        departmentId: 'DEP-002',
        roles: ['employee', 'analyst', 'research-service'],
        active: true
      },
      {
        id: 'EMP-004',
        name: '赵敏',
        departmentId: 'DEP-003',
        roles: ['employee', 'reviewer', 'hr', 'it-coordinator', 'risk-reviewer', 'ib-committee'],
        active: true
      },
      {
        id: 'EMP-005',
        name: '刘洋',
        departmentId: 'DEP-002',
        roles: ['quality', 'risk-investigator'],
        active: true
      },
      {
        id: 'EMP-006',
        name: '周宁',
        departmentId: 'DEP-003',
        roles: ['compliance', 'it-agent', 'risk-monitor'],
        active: true
      },
      { id: 'EMP-007', name: '徐嘉', departmentId: 'DEP-002', roles: ['publisher'], active: true },
      { id: 'EMP-008', name: '张远', departmentId: 'DEP-003', roles: ['ib-manager'], active: true },
      { id: 'EMP-009', name: '李桐', departmentId: 'DEP-003', roles: ['ib-member'], active: true },
      { id: 'EMP-010', name: '孙岚', departmentId: 'DEP-003', roles: ['ib-quality'], active: true },
      { id: 'EMP-011', name: '郑航', departmentId: 'DEP-003', roles: ['ib-committee'], active: false },
      { id: 'EMP-012', name: '何安', departmentId: 'DEP-003', roles: ['employee'], active: false }
    ],
    officeTeams: [
      {
        id: 'TEAM-001',
        name: '跨部门协作组',
        projectId: 'IBP-001',
        ownerId: 'EMP-008',
        memberIds: ['EMP-003', 'EMP-009'],
        businessVersion: 1
      }
    ],
    contactGroups: [
      {
        id: 'CGROUP-001',
        name: '项目通讯分组',
        ownerId: 'EMP-008',
        memberIds: ['EMP-003', 'EMP-009'],
        businessVersion: 1
      }
    ],
    notices: [
      {
        id: 'NTC-001',
        title: '办公通知草稿',
        body: '请查阅办公安排。',
        authorId: 'EMP-004',
        recipientDepartmentIds: ['DEP-001'],
        status: 'draft',
        businessVersion: 1,
        createdAt: now
      },
      {
        id: 'NTC-002',
        title: '研究部通知',
        body: '这是已发布的通知。',
        authorId: 'EMP-004',
        recipientDepartmentIds: ['DEP-002'],
        status: 'published',
        businessVersion: 2,
        createdAt: now
      }
    ],
    noticePublications: [
      {
        id: 'NPUB-001',
        noticeId: 'NTC-002',
        recipientDepartmentIds: ['DEP-002'],
        recipientEmployeeIds: ['EMP-003', 'EMP-005', 'EMP-007'],
        publishedAt: now
      }
    ],
    noticeReceipts: [
      { id: 'NREC-001', noticeId: 'NTC-002', employeeId: 'EMP-003', readAt: now },
      { id: 'NREC-002', noticeId: 'NTC-002', employeeId: 'EMP-005', readAt: null },
      { id: 'NREC-003', noticeId: 'NTC-002', employeeId: 'EMP-007', readAt: null }
    ],
    noticeReminders: [],
    mailMessages: [
      {
        id: 'MAIL-001',
        senderId: 'EMP-003',
        recipientIds: ['EMP-001'],
        subject: '项目资料确认',
        body: '请确认项目资料与时间安排。',
        attachmentIds: ['MAILAST-001'],
        folder: 'inbox',
        businessVersion: 1,
        receivedAt: now
      },
      {
        id: 'MAIL-002',
        senderId: 'EMP-004',
        recipientIds: ['EMP-001'],
        subject: '办公周报',
        body: '这是供检索的第二封邮件。',
        attachmentIds: [],
        folder: 'inbox',
        businessVersion: 1,
        receivedAt: now
      }
    ],
    mailAttachments: [
      {
        id: 'MAILAST-001',
        ownerId: 'MAIL-001',
        filename: '项目资料.txt',
        mimeType: 'text/plain',
        content: '项目资料包含进度计划、联系人及交付清单。'
      },
      {
        id: 'MAILAST-002',
        ownerId: 'REPLY-001',
        filename: '回执.txt',
        mimeType: 'text/plain',
        content: '附件包含本次沟通的问题清单与回复意见。'
      }
    ],
    mailReplies: [
      {
        id: 'REPLY-001',
        sourceMailId: 'MAIL-001',
        authorId: 'EMP-001',
        recipientIds: ['EMP-003'],
        body: '已收到，按安排处理。',
        attachmentIds: ['MAILAST-002'],
        status: 'draft',
        businessVersion: 1,
        createdAt: now
      }
    ],
    mailSendRecords: [],
    officeDiscussions: [
      {
        id: 'DISC-001',
        projectId: 'IBP-001',
        creatorId: 'EMP-008',
        title: '项目资料讨论',
        body: '请协作确认尽调资料。',
        createdAt: now
      }
    ],
    meetingResources: [
      { id: 'ROOM-001', name: '小会议室', capacity: 4 },
      { id: 'ROOM-002', name: '多功能会议室', capacity: 8 }
    ],
    meetings: [
      {
        id: 'MTG-001',
        title: '客户沟通会',
        organizerId: 'EMP-001',
        participantIds: ['EMP-001', 'EMP-002'],
        resourceId: 'ROOM-001',
        startAt: '2026-09-19T02:00:00.000Z',
        endAt: '2026-09-19T03:00:00.000Z',
        businessVersion: 1,
        createdAt: now
      },
      {
        id: 'MTG-002',
        title: '研究讨论会',
        organizerId: 'EMP-003',
        participantIds: ['EMP-003', 'EMP-004'],
        resourceId: 'ROOM-002',
        startAt: '2026-09-19T02:00:00.000Z',
        endAt: '2026-09-19T03:00:00.000Z',
        businessVersion: 1,
        createdAt: now
      },
      {
        id: 'MTG-003',
        title: '晨会纪要',
        organizerId: 'EMP-003',
        participantIds: ['EMP-003', 'EMP-004'],
        resourceId: 'ROOM-002',
        startAt: '2026-09-19T00:00:00.000Z',
        endAt: '2026-09-19T01:00:00.000Z',
        businessVersion: 1,
        createdAt: '2026-09-18T08:00:00.000Z'
      }
    ],
    meetingNotifications: [],
    meetingMinutes: [],
    clients: [
      {
        id: 'CLI-001',
        name: '嘉和实业有限公司',
        kind: 'institution',
        managerId: 'EMP-001',
        riskLevel: 3
      },
      {
        id: 'CLI-002',
        name: '顾承安',
        kind: 'individual',
        managerId: 'EMP-001',
        riskLevel: 2
      },
      {
        id: 'CLI-003',
        name: '沈知夏',
        kind: 'individual',
        managerId: 'EMP-001',
        riskLevel: 2
      }
    ],
    products: [
      { id: 'PRD-001', name: '稳盈中短债集合资产管理计划', riskLevel: 2, active: true },
      { id: 'PRD-002', name: '成长优选混合资产管理计划', riskLevel: 4, active: true }
    ],
    suitabilityPolicy: {
      version: 1,
      questionnaireMaxAgeDays: 365,
      matchingRule: 'product-risk-at-most-assessed-risk'
    },
    clientCases: [
      {
        clientId: 'CLI-001',
        businessVersion: 1,
        status: 'draft',
        identityDocumentNo: 'DEMO-IDENTITY-001',
        contactPhone: '13800000001',
        questionnaire: { riskTolerance: 3, lossCapacity: 3, answeredAt: now },
        archivedAt: null
      },
      {
        clientId: 'CLI-002',
        businessVersion: 1,
        status: 'draft',
        identityDocumentNo: null,
        contactPhone: null,
        questionnaire: null,
        archivedAt: null
      },
      {
        clientId: 'CLI-003',
        businessVersion: 1,
        status: 'draft',
        identityDocumentNo: 'DEMO-IDENTITY-003',
        contactPhone: '13800000003',
        questionnaire: { riskTolerance: 2, lossCapacity: 2, answeredAt: '2024-09-19T00:00:00.000Z' },
        archivedAt: null
      }
    ],
    suitabilityAssessments: [],
    suitabilityMatches: [],
    clientReviews: [],
    researchPolicy: { version: 1, minimumCitations: 1, minimumDisclosures: 1 },
    researchTopics: [
      { id: 'TOPIC-001', title: '行业观察', analystId: 'EMP-003', createdAt: now },
      { id: 'TOPIC-002', title: '公司跟踪', analystId: 'EMP-003', createdAt: now },
      { id: 'TOPIC-003', title: '主题修订', analystId: 'EMP-003', createdAt: now }
    ],
    researchReports: [
      {
        id: 'REPORT-001',
        topicId: 'TOPIC-001',
        authorId: 'EMP-003',
        status: 'draft',
        businessVersion: 1,
        documentVersion: 1,
        archivedAt: null
      },
      {
        id: 'REPORT-002',
        topicId: 'TOPIC-002',
        authorId: 'EMP-003',
        status: 'draft',
        businessVersion: 1,
        documentVersion: 1,
        archivedAt: null
      },
      {
        id: 'REPORT-003',
        topicId: 'TOPIC-003',
        authorId: 'EMP-003',
        status: 'draft',
        businessVersion: 1,
        documentVersion: 1,
        archivedAt: null
      }
    ],
    researchDocumentVersions: [
      {
        id: 'RVER-001',
        reportId: 'REPORT-001',
        version: 1,
        title: '行业观察报告',
        content: '仅使用资料讨论行业变化。',
        citations: ['DEMO-SOURCE-001'],
        disclosures: ['本报告基于公开资料和行业调研编制。'],
        authorId: 'EMP-003',
        createdAt: now
      },
      {
        id: 'RVER-002',
        reportId: 'REPORT-002',
        version: 1,
        title: '公司跟踪报告',
        content: '待补引用与披露的草稿。',
        citations: [],
        disclosures: [],
        authorId: 'EMP-003',
        createdAt: now
      },
      {
        id: 'RVER-003',
        reportId: 'REPORT-003',
        version: 1,
        title: '主题修订报告',
        content: '可供退回修改的草稿。',
        citations: ['DEMO-SOURCE-003'],
        disclosures: ['本报告适用于内部研究交流。'],
        authorId: 'EMP-003',
        createdAt: now
      }
    ],
    researchChecks: [],
    researchReviews: [],
    researchPublications: [],
    ibPolicy: { version: 1, requiredWorkpaperKinds: ['financial', 'legal'], blockingSeverity: 'blocking' },
    ibIssuers: [
      { id: 'ISS-001', name: '远航新材料股份有限公司', industry: '制造业' },
      { id: 'ISS-002', name: '明德城市服务股份有限公司', industry: '服务业' },
      { id: 'ISS-003', name: '华辰科技股份有限公司', industry: '科技业' }
    ],
    ibProjects: [
      {
        id: 'IBP-001',
        issuerId: 'ISS-001',
        title: '远航新材公司债立项尽调',
        managerId: 'EMP-008',
        status: 'diligence',
        businessVersion: 1,
        lastReturnVersion: null,
        createdAt: now,
        archivedAt: null
      },
      {
        id: 'IBP-002',
        issuerId: 'ISS-002',
        title: '明德城服并购项目资料补齐',
        managerId: 'EMP-008',
        status: 'diligence',
        businessVersion: 1,
        lastReturnVersion: null,
        createdAt: now,
        archivedAt: null
      },
      {
        id: 'IBP-003',
        issuerId: 'ISS-003',
        title: '华辰科技再融资项目整改',
        managerId: 'EMP-008',
        status: 'diligence',
        businessVersion: 1,
        lastReturnVersion: null,
        createdAt: now,
        archivedAt: null
      }
    ],
    ibAssignments: [
      {
        id: 'IBASG-001',
        projectId: 'IBP-001',
        kind: 'financial',
        memberId: 'EMP-009',
        assignedBy: 'EMP-008',
        assignedAt: now
      },
      {
        id: 'IBASG-002',
        projectId: 'IBP-001',
        kind: 'legal',
        memberId: 'EMP-009',
        assignedBy: 'EMP-008',
        assignedAt: now
      },
      {
        id: 'IBASG-003',
        projectId: 'IBP-002',
        kind: 'financial',
        memberId: 'EMP-009',
        assignedBy: 'EMP-008',
        assignedAt: now
      },
      {
        id: 'IBASG-004',
        projectId: 'IBP-003',
        kind: 'financial',
        memberId: 'EMP-009',
        assignedBy: 'EMP-008',
        assignedAt: now
      },
      {
        id: 'IBASG-005',
        projectId: 'IBP-003',
        kind: 'legal',
        memberId: 'EMP-009',
        assignedBy: 'EMP-008',
        assignedAt: now
      }
    ],
    ibWorkpapers: [
      {
        id: 'IBWP-001',
        projectId: 'IBP-001',
        kind: 'financial',
        version: 1,
        assetId: 'IBAST-001',
        summary: '财务底稿甲',
        memberId: 'EMP-009',
        businessVersion: 1,
        submittedAt: now
      },
      {
        id: 'IBWP-002',
        projectId: 'IBP-001',
        kind: 'legal',
        version: 1,
        assetId: 'IBAST-002',
        summary: '法律底稿甲',
        memberId: 'EMP-009',
        businessVersion: 1,
        submittedAt: now
      },
      {
        id: 'IBWP-003',
        projectId: 'IBP-002',
        kind: 'financial',
        version: 1,
        assetId: 'IBAST-003',
        summary: '财务底稿乙',
        memberId: 'EMP-009',
        businessVersion: 1,
        submittedAt: now
      },
      {
        id: 'IBWP-004',
        projectId: 'IBP-003',
        kind: 'financial',
        version: 1,
        assetId: 'IBAST-005',
        summary: '财务底稿丙',
        memberId: 'EMP-009',
        businessVersion: 1,
        submittedAt: now
      },
      {
        id: 'IBWP-005',
        projectId: 'IBP-003',
        kind: 'legal',
        version: 1,
        assetId: 'IBAST-006',
        summary: '法律底稿丙',
        memberId: 'EMP-009',
        businessVersion: 1,
        submittedAt: now
      }
    ],
    ibFindings: [
      {
        id: 'IBFIND-001',
        projectId: 'IBP-002',
        severity: 'blocking',
        description: '法律底稿缺失待核对',
        status: 'open',
        openedBy: 'EMP-010',
        openedAt: now,
        resolution: null,
        resolvedBy: null,
        resolvedAt: null
      }
    ],
    ibQualitySubmissions: [],
    ibReviews: [],
    forms: [
      {
        id: 'FORM-001',
        kind: 'travel',
        applicantId: 'EMP-001',
        departmentId: 'DEP-001',
        status: 'submitted',
        businessVersion: 1,
        amountCents: 10000 + (seededNumber(seed) % 5000),
        createdAt: now
      },
      {
        id: 'FORM-002',
        kind: 'travel',
        applicantId: 'EMP-001',
        departmentId: 'DEP-001',
        status: 'draft',
        businessVersion: 1,
        amountCents: 20000 + (seededNumber(seed + 1) % 5000),
        createdAt: now
      },
      {
        id: 'OFFORM-001',
        kind: 'general',
        applicantId: 'EMP-001',
        departmentId: 'DEP-001',
        status: 'submitted',
        businessVersion: 1,
        amountCents: 0,
        createdAt: now
      }
    ],
    travelRequests: [
      {
        formId: 'FORM-001',
        origin: '上海',
        destination: '北京',
        startAt: '2026-09-22T09:00:00+08:00',
        endAt: '2026-09-23T18:00:00+08:00',
        travelerIds: ['EMP-001']
      }
    ],
    expenseClaims: [],
    attachments: [
      {
        assetId: 'AST-001',
        filename: '行程说明.txt',
        mimeType: 'text/plain',
        sizeBytes: 128,
        ownerId: 'FORM-001'
      },
      {
        assetId: 'AST-002',
        filename: '待关联的凭证.txt',
        mimeType: 'text/plain',
        sizeBytes: 64,
        ownerId: ''
      },
      {
        assetId: 'AST-003',
        filename: '交通票据-001.txt',
        mimeType: 'text/plain',
        sizeBytes: 96,
        ownerId: 'FORM-001'
      },
      {
        assetId: 'AST-004',
        filename: '住宿票据-002.txt',
        mimeType: 'text/plain',
        sizeBytes: 96,
        ownerId: 'FORM-001'
      },
      {
        assetId: 'IBAST-001',
        filename: '甲财务底稿.txt',
        mimeType: 'text/plain',
        sizeBytes: 256,
        ownerId: 'IBP-001'
      },
      {
        assetId: 'IBAST-002',
        filename: '甲法律底稿.txt',
        mimeType: 'text/plain',
        sizeBytes: 256,
        ownerId: 'IBP-001'
      },
      {
        assetId: 'IBAST-003',
        filename: '乙财务底稿.txt',
        mimeType: 'text/plain',
        sizeBytes: 256,
        ownerId: 'IBP-002'
      },
      {
        assetId: 'IBAST-004',
        filename: '乙法律底稿.txt',
        mimeType: 'text/plain',
        sizeBytes: 256,
        ownerId: 'IBP-002'
      },
      {
        assetId: 'IBAST-005',
        filename: '丙财务底稿首版.txt',
        mimeType: 'text/plain',
        sizeBytes: 256,
        ownerId: 'IBP-003'
      },
      {
        assetId: 'IBAST-006',
        filename: '丙法律底稿.txt',
        mimeType: 'text/plain',
        sizeBytes: 256,
        ownerId: 'IBP-003'
      },
      {
        assetId: 'IBAST-007',
        filename: '丙财务底稿补正版.txt',
        mimeType: 'text/plain',
        sizeBytes: 320,
        ownerId: 'IBP-003'
      }
    ],
    documentVersions: [
      {
        id: 'DOCVER-001',
        documentId: 'DOC-001',
        version: 1,
        title: '办公指引',
        content: '本指引用于规范部门日常办公和审批流程。',
        blocks: [
          { id: 'DBLK-001', kind: 'heading', text: '办公指引' },
          { id: 'DBLK-002', kind: 'paragraph', text: '本指引用于规范部门日常办公和审批流程。' }
        ],
        authorId: 'EMP-003',
        createdAt: now
      },
      {
        id: 'DOCVER-002',
        documentId: 'DOC-002',
        version: 1,
        title: '研究资料规范',
        content: '研究资料归档前应完成内容复核和来源核对。',
        blocks: [
          { id: 'DBLK-001', kind: 'heading', text: '研究资料规范' },
          { id: 'DBLK-002', kind: 'paragraph', text: '研究资料归档前应完成内容复核和来源核对。' }
        ],
        authorId: 'EMP-003',
        createdAt: now
      }
    ],
    officeDocuments: [
      {
        id: 'DOC-001',
        source: '办公制度库',
        ownerId: 'EMP-003',
        reviewerId: 'EMP-004',
        currentVersion: 1,
        status: 'draft',
        businessVersion: 1
      },
      {
        id: 'DOC-002',
        source: '研究制度库',
        ownerId: 'EMP-003',
        reviewerId: 'EMP-004',
        currentVersion: 1,
        status: 'approved',
        businessVersion: 2
      }
    ],
    officeDocumentApprovals: [
      { id: 'OAPP-001', documentId: 'DOC-002', documentVersion: 1, reviewerId: 'EMP-004', approvedAt: now }
    ],
    officeDocumentArchives: [],
    sheetRows: [
      {
        id: 'SROW-001',
        departmentId: 'DEP-001',
        label: '客户资料整理',
        amountCents: 12000,
        status: 'draft',
        businessVersion: 1
      },
      {
        id: 'SROW-002',
        departmentId: 'DEP-002',
        label: '研究资料复核',
        amountCents: 8600,
        status: 'confirmed',
        businessVersion: 1
      },
      {
        id: 'SROW-003',
        departmentId: 'DEP-001',
        label: '客户沟通记录',
        amountCents: 4500,
        status: 'confirmed',
        businessVersion: 1
      },
      {
        id: 'SROW-004',
        departmentId: 'DEP-003',
        label: '运营档案归整',
        amountCents: 16800,
        status: 'draft',
        businessVersion: 1
      },
      {
        id: 'SROW-005',
        departmentId: 'DEP-002',
        label: '行业数据整理',
        amountCents: 7200,
        status: 'draft',
        businessVersion: 1
      }
    ],
    sheetExports: [],
    sheetPatchRecords: [],
    officeApprovalMaterials: [
      { id: 'APMAT-001', name: '采购说明' },
      { id: 'APMAT-002', name: '补正说明' }
    ],
    officeApprovalRequests: [
      {
        id: 'APPR-001',
        applicantId: 'EMP-001',
        departmentId: 'DEP-001',
        reviewerId: 'EMP-002',
        title: '办公用品申请',
        description: '申请办公用品。',
        materialIds: ['APMAT-001'],
        status: 'submitted',
        businessVersion: 1,
        currentTaskId: 'APPTODO-001',
        createdAt: now
      },
      {
        id: 'APPR-002',
        applicantId: 'EMP-001',
        departmentId: 'DEP-001',
        reviewerId: 'EMP-002',
        title: '资料补正申请',
        description: '待补充说明后重新提交。',
        materialIds: ['APMAT-002'],
        status: 'returned',
        businessVersion: 2,
        currentTaskId: null,
        createdAt: now
      },
      {
        id: 'APPR-003',
        applicantId: 'EMP-001',
        departmentId: 'DEP-001',
        reviewerId: 'EMP-002',
        title: '已批准申请',
        description: '申请材料已经审核完成。',
        materialIds: ['APMAT-001'],
        status: 'approved',
        businessVersion: 2,
        currentTaskId: null,
        createdAt: now
      }
    ],
    officeApprovalDecisions: [
      {
        id: 'APDEC-001',
        requestId: 'APPR-002',
        taskId: 'APPTODO-002',
        action: 'return',
        actorId: 'EMP-002',
        opinion: '请补充用途。',
        businessVersion: 2,
        decidedAt: now
      },
      {
        id: 'APDEC-002',
        requestId: 'APPR-003',
        taskId: 'APPTODO-003',
        action: 'approve',
        actorId: 'EMP-002',
        opinion: '资料齐全，同意。',
        businessVersion: 2,
        decidedAt: now
      }
    ],
    officeApprovalOperationRecords: [],
    leaveBalances: Array.from({ length: 12 }, (_, index) => ({
      employeeId: `EMP-${String(index + 1).padStart(3, '0')}`,
      totalDays: index === 0 ? 5 : index === 2 ? 8 : 5
    })),
    leaveRequests: [],
    attendanceCorrections: [],
    personnelMaterials: [
      { id: 'PMAT-001', name: '身份证明', kind: 'identity' },
      { id: 'PMAT-002', name: '劳动合同', kind: 'contract' },
      { id: 'PMAT-003', name: '调动单', kind: 'transfer-order' },
      { id: 'PMAT-004', name: '岗位审批单', kind: 'role-approval' },
      { id: 'PMAT-005', name: '离职交接清单', kind: 'exit-checklist' }
    ],
    personnelProfiles: [
      { employeeId: 'EMP-001', position: '客户服务专员', businessVersion: 1 },
      { employeeId: 'EMP-003', position: '研究分析师', businessVersion: 1 },
      { employeeId: 'EMP-012', position: '离职人员', businessVersion: 1 }
    ],
    personnelChanges: [],
    trainingCourses: [
      { id: 'TRN-001', title: '合规入门培训', capacity: 2 },
      { id: 'TRN-002', title: '研究资料培训', capacity: 1 }
    ],
    trainingEnrollments: [
      {
        id: 'ENR-001',
        courseId: 'TRN-002',
        employeeId: 'EMP-003',
        status: 'enrolled',
        businessVersion: 1,
        enrolledAt: now,
        completedAt: null,
        completedBy: null
      }
    ],
    hrOperationRecords: [],
    procurementSuppliers: [
      { id: 'SUP-001', name: '启明办公设备有限公司', status: 'approved', businessVersion: 2 },
      { id: 'SUP-002', name: '优文商贸有限公司', status: 'approved', businessVersion: 2 },
      { id: 'SUP-003', name: '待审核供应商', status: 'pending', businessVersion: 1 },
      { id: 'SUP-004', name: '过期证明供应商', status: 'pending', businessVersion: 1 }
    ],
    supplierProofs: [
      { id: 'SPRF-001', supplierId: 'SUP-001', kind: 'registration', expiresOn: '2027-12-31' },
      { id: 'SPRF-002', supplierId: 'SUP-001', kind: 'tax', expiresOn: '2027-12-31' },
      { id: 'SPRF-003', supplierId: 'SUP-002', kind: 'registration', expiresOn: '2027-12-31' },
      { id: 'SPRF-004', supplierId: 'SUP-002', kind: 'tax', expiresOn: '2027-12-31' },
      { id: 'SPRF-005', supplierId: 'SUP-003', kind: 'registration', expiresOn: '2027-12-31' },
      { id: 'SPRF-006', supplierId: 'SUP-003', kind: 'tax', expiresOn: '2027-12-31' },
      { id: 'SPRF-007', supplierId: 'SUP-004', kind: 'registration', expiresOn: '2026-01-01' }
    ],
    supplierReviews: [],
    purchaseRequests: [
      {
        id: 'PREQ-001',
        requesterId: 'EMP-001',
        itemName: '笔记本',
        quantity: 5,
        status: 'draft',
        selectedSupplierId: null,
        unitPriceCents: null,
        totalCents: null,
        businessVersion: 1,
        createdAt: now
      },
      {
        id: 'PREQ-002',
        requesterId: 'EMP-001',
        itemName: '办公键盘',
        quantity: 4,
        status: 'selected',
        selectedSupplierId: 'SUP-001',
        unitPriceCents: 1200,
        totalCents: 4800,
        businessVersion: 2,
        createdAt: now
      }
    ],
    purchaseComparisons: [
      {
        id: 'PCMP-001',
        requestId: 'PREQ-002',
        quotes: [
          { supplierId: 'SUP-001', unitPriceCents: 1200, totalCents: 4800 },
          { supplierId: 'SUP-002', unitPriceCents: 1500, totalCents: 6000 }
        ],
        selectedSupplierId: 'SUP-001',
        selectedTotalCents: 4800,
        comparedAt: now
      }
    ],
    purchaseReceipts: [],
    inventoryEntries: [],
    procurementOperationRecords: [],
    contractMaterials: [
      { id: 'CTMAT-001', name: '设备采购合同原件', expiresOn: '2027-12-31', contractId: 'CNTR-001' },
      { id: 'CTMAT-002', name: '已过期授权书', expiresOn: '2026-01-01', contractId: 'CNTR-002' },
      { id: 'CTMAT-003', name: '待登记合同附件', expiresOn: '2027-12-31', contractId: null },
      { id: 'CTMAT-004', name: '续签合同附件', expiresOn: '2027-12-31', contractId: null }
    ],
    officeContracts: [
      {
        id: 'CNTR-001',
        ownerId: 'EMP-001',
        companyId: 'COMP-001',
        counterpartyName: '云帆信息技术有限公司',
        startDate: '2025-09-26',
        endDate: '2026-09-25',
        amountCents: 120000,
        materialIds: ['CTMAT-001'],
        businessVersion: 1,
        renewedFromContractId: null,
        sourceVersion: null,
        createdAt: now
      },
      {
        id: 'CNTR-002',
        ownerId: 'EMP-001',
        companyId: 'COMP-001',
        counterpartyName: '启明办公设备有限公司',
        startDate: '2026-01-01',
        endDate: '2027-12-31',
        amountCents: 80000,
        materialIds: ['CTMAT-002'],
        businessVersion: 1,
        renewedFromContractId: null,
        sourceVersion: null,
        createdAt: now
      }
    ],
    sealRequests: [
      {
        id: 'SEAL-001',
        contractId: 'CNTR-001',
        contractVersion: 1,
        applicantId: 'EMP-001',
        purpose: '合同签署',
        materialIds: ['CTMAT-001'],
        status: 'pending',
        reviewerId: null,
        decisionNote: null,
        businessVersion: 1,
        submittedAt: now,
        decidedAt: null,
        executedAt: null
      },
      {
        id: 'SEAL-002',
        contractId: 'CNTR-001',
        contractVersion: 1,
        applicantId: 'EMP-001',
        purpose: '归档用印',
        materialIds: ['CTMAT-001'],
        status: 'approved',
        reviewerId: 'EMP-004',
        decisionNote: '审批通过。',
        businessVersion: 2,
        submittedAt: now,
        decidedAt: now,
        executedAt: null
      }
    ],
    contractOperationRecords: [],
    adminAssets: [
      { id: 'EQ-001', name: '联想办公笔记本 01', status: 'available', holderId: null, businessVersion: 1 },
      { id: 'EQ-002', name: '联想办公笔记本 02', status: 'assigned', holderId: 'EMP-003', businessVersion: 2 },
      { id: 'EQ-003', name: '待修打印机', status: 'repair', holderId: null, businessVersion: 1 },
      { id: 'EQ-004', name: '已处理投影仪', status: 'repair', holderId: null, businessVersion: 1 }
    ],
    assetMovements: [
      { id: 'AMOV-001', assetId: 'EQ-002', holderId: 'EMP-003', actorId: 'EMP-002', action: 'assign', at: now }
    ],
    adminResources: [
      { id: 'RES-001', name: '行政会议室', kind: 'meeting-room', capacity: 8, authorizedDriverIds: [] },
      { id: 'RES-002', name: '公务车', kind: 'vehicle', capacity: 4, authorizedDriverIds: ['EMP-002'] }
    ],
    resourceReservations: [
      {
        id: 'RSV-001',
        resourceId: 'RES-001',
        actorId: 'EMP-001',
        participantIds: ['EMP-001', 'EMP-003'],
        driverId: null,
        startAt: '2026-09-20T02:00:00.000Z',
        endAt: '2026-09-20T03:00:00.000Z',
        status: 'reserved',
        createdAt: now
      }
    ],
    repairTickets: [
      {
        id: 'REP-001',
        assetId: 'EQ-003',
        reporterId: 'EMP-001',
        assigneeId: 'EMP-004',
        issue: '打印机无法进纸',
        status: 'open',
        resolution: null,
        businessVersion: 1,
        resolvedAt: null,
        acceptedAt: null
      },
      {
        id: 'REP-002',
        assetId: 'EQ-004',
        reporterId: 'EMP-001',
        assigneeId: 'EMP-004',
        issue: '投影仪画面异常',
        status: 'resolved',
        resolution: '已更换连接线。',
        businessVersion: 2,
        resolvedAt: now,
        acceptedAt: null
      }
    ],
    adminOperationRecords: [],
    officeProjects: [
      {
        id: 'PRJ-001',
        title: '办公迁移项目',
        ownerId: 'EMP-001',
        memberIds: ['EMP-001', 'EMP-002', 'EMP-003'],
        dueDate: '2026-09-30',
        businessVersion: 1,
        createdAt: now
      }
    ],
    projectTasks: [
      {
        id: 'PTASK-001',
        projectId: 'PRJ-001',
        title: '整理需求',
        assigneeId: 'EMP-001',
        dueDate: '2026-09-18',
        dependencyIds: [],
        status: 'done',
        businessVersion: 2,
        createdAt: now,
        completedAt: now
      },
      {
        id: 'PTASK-002',
        projectId: 'PRJ-001',
        title: '完成界面联调',
        assigneeId: 'EMP-003',
        dueDate: '2026-09-18',
        dependencyIds: ['PTASK-001'],
        status: 'open',
        businessVersion: 1,
        createdAt: now,
        completedAt: null
      },
      {
        id: 'PTASK-003',
        projectId: 'PRJ-001',
        title: '验收',
        assigneeId: 'EMP-002',
        dueDate: '2026-09-25',
        dependencyIds: ['PTASK-002'],
        status: 'open',
        businessVersion: 1,
        createdAt: now,
        completedAt: null
      }
    ],
    projectMilestones: [
      {
        id: 'PMS-001',
        projectId: 'PRJ-001',
        title: '需求冻结',
        dueDate: '2026-09-18',
        taskIds: ['PTASK-001'],
        businessVersion: 1
      },
      {
        id: 'PMS-002',
        projectId: 'PRJ-001',
        title: '上线',
        dueDate: '2026-09-25',
        taskIds: ['PTASK-002', 'PTASK-003'],
        businessVersion: 1
      }
    ],
    projectWeeklyReports: [],
    projectOperationRecords: [],
    itSystems: [
      { id: 'SYS-001', name: '办公系统' },
      { id: 'SYS-002', name: '研究系统' }
    ],
    itPermissions: [
      {
        id: 'PERM-001',
        systemId: 'SYS-001',
        name: '办公只读',
        allowedRoles: ['employee'],
        requiredMaterialKinds: ['identity']
      },
      {
        id: 'PERM-002',
        systemId: 'SYS-002',
        name: '研究编辑',
        allowedRoles: ['analyst'],
        requiredMaterialKinds: ['identity', 'training']
      },
      {
        id: 'PERM-003',
        systemId: 'SYS-002',
        name: '研究发布',
        allowedRoles: ['publisher'],
        requiredMaterialKinds: ['identity', 'training', 'manager-approval']
      }
    ],
    accessMaterials: [
      { id: 'ACMAT-001', ownerId: 'EMP-001', kind: 'identity', expiresOn: '2027-12-31' },
      { id: 'ACMAT-002', ownerId: 'EMP-003', kind: 'identity', expiresOn: '2027-12-31' },
      { id: 'ACMAT-003', ownerId: 'EMP-003', kind: 'training', expiresOn: '2027-12-31' },
      { id: 'ACMAT-004', ownerId: 'EMP-007', kind: 'identity', expiresOn: '2027-12-31' }
    ],
    accessRequests: [],
    accessGrants: [],
    itTickets: [
      {
        id: 'TKT-001',
        title: '办公终端登录异常',
        requesterId: 'EMP-001',
        assigneeId: null,
        status: 'new',
        resolution: null,
        acceptanceNote: null,
        businessVersion: 1,
        createdAt: now,
        resolvedAt: null,
        closedAt: null
      },
      {
        id: 'TKT-002',
        title: '打印服务异常',
        requesterId: 'EMP-001',
        assigneeId: 'EMP-006',
        status: 'assigned',
        resolution: null,
        acceptanceNote: null,
        businessVersion: 2,
        createdAt: now,
        resolvedAt: null,
        closedAt: null
      },
      {
        id: 'TKT-003',
        title: '工作站配置调整',
        requesterId: 'EMP-001',
        assigneeId: 'EMP-006',
        status: 'resolved',
        resolution: '已调整配置并验证。',
        acceptanceNote: null,
        businessVersion: 3,
        createdAt: now,
        resolvedAt: now,
        closedAt: null
      }
    ],
    itTicketEvents: [
      {
        id: 'TEVT-001',
        ticketId: 'TKT-002',
        actorId: 'EMP-004',
        fromStatus: 'new',
        toStatus: 'assigned',
        note: '分派给 EMP-006',
        businessVersion: 2,
        at: now
      },
      {
        id: 'TEVT-002',
        ticketId: 'TKT-003',
        actorId: 'EMP-004',
        fromStatus: 'new',
        toStatus: 'assigned',
        note: '分派给 EMP-006',
        businessVersion: 2,
        at: now
      },
      {
        id: 'TEVT-003',
        ticketId: 'TKT-003',
        actorId: 'EMP-006',
        fromStatus: 'assigned',
        toStatus: 'resolved',
        note: '已调整配置并验证。',
        businessVersion: 3,
        at: now
      }
    ],
    itOperationRecords: [],
    officeReportJobs: [
      {
        id: 'RJOB-001',
        actorId: 'EMP-004',
        departmentId: 'DEP-002',
        startDate: '2026-09-18',
        endDate: '2026-09-18',
        status: 'completed',
        unit: '件',
        totalCount: 1,
        anomalyCount: 1,
        rows: [
          {
            sourceType: 'project-task',
            sourceId: 'PTASK-002',
            sourceVersion: 1,
            departmentId: 'DEP-002',
            occurredOn: '2026-09-18',
            title: '完成界面联调',
            sourceStatus: 'open',
            anomalyReason: '任务逾期'
          }
        ],
        acceptedAt: now,
        completedAt: now
      }
    ],
    officeArchives: [
      {
        id: 'ARC-001',
        ownerId: 'EMP-004',
        currentVersion: 1,
        versions: [
          {
            version: 1,
            reportId: 'RJOB-001',
            departmentId: 'DEP-002',
            startDate: '2026-09-18',
            endDate: '2026-09-18',
            unit: '件',
            totalCount: 1,
            anomalyCount: 1,
            rows: [
              {
                sourceType: 'project-task',
                sourceId: 'PTASK-002',
                sourceVersion: 1,
                departmentId: 'DEP-002',
                occurredOn: '2026-09-18',
                title: '完成界面联调',
                sourceStatus: 'open',
                anomalyReason: '任务逾期'
              }
            ],
            savedAt: now
          }
        ]
      }
    ],
    officeArchiveOperations: [
      {
        id: 'AOP-001',
        archiveId: 'ARC-001',
        actorId: 'EMP-004',
        action: 'save',
        version: 1,
        reportId: 'RJOB-001',
        at: now
      }
    ],
    reportOperationRecords: [],
    riskRules: [
      {
        id: 'RRULE-001',
        version: 1,
        name: '客户活动次数',
        threshold: 3,
        unit: '次/7日',
        requiredEvidenceKinds: ['activity-log', 'identity-check']
      },
      {
        id: 'RRULE-002',
        version: 1,
        name: '项目指标分值',
        threshold: 80,
        unit: '分',
        requiredEvidenceKinds: ['project-metric', 'review-note']
      }
    ],
    riskAlerts: [
      {
        id: 'RALT-001',
        title: '客户活动核查',
        sourceType: 'client',
        sourceId: 'CLI-001',
        ruleId: 'RRULE-001',
        ruleVersion: 1,
        observedValue: 4,
        status: 'new',
        assigneeId: null,
        latestInvestigationId: null,
        latestReviewId: null,
        businessVersion: 1,
        createdAt: now,
        completedAt: null
      },
      {
        id: 'RALT-002',
        title: '投行项目指标核查',
        sourceType: 'ib-project',
        sourceId: 'IBP-001',
        ruleId: 'RRULE-002',
        ruleVersion: 1,
        observedValue: 86,
        status: 'new',
        assigneeId: null,
        latestInvestigationId: null,
        latestReviewId: null,
        businessVersion: 1,
        createdAt: now,
        completedAt: null
      },
      {
        id: 'RALT-003',
        title: '客户资料补正调查',
        sourceType: 'client',
        sourceId: 'CLI-002',
        ruleId: 'RRULE-001',
        ruleVersion: 1,
        observedValue: 5,
        status: 'returned',
        assigneeId: 'EMP-005',
        latestInvestigationId: 'RINV-001',
        latestReviewId: 'RREV-001',
        businessVersion: 4,
        createdAt: now,
        completedAt: null
      },
      {
        id: 'RALT-004',
        title: '项目升级待办',
        sourceType: 'ib-project',
        sourceId: 'IBP-002',
        ruleId: 'RRULE-002',
        ruleVersion: 1,
        observedValue: 91,
        status: 'approved',
        assigneeId: 'EMP-005',
        latestInvestigationId: 'RINV-002',
        latestReviewId: 'RREV-002',
        businessVersion: 4,
        createdAt: now,
        completedAt: null
      },
      {
        id: 'RALT-005',
        title: '客户待复核预警',
        sourceType: 'client',
        sourceId: 'CLI-003',
        ruleId: 'RRULE-001',
        ruleVersion: 1,
        observedValue: 4,
        status: 'pending-review',
        assigneeId: 'EMP-005',
        latestInvestigationId: 'RINV-003',
        latestReviewId: null,
        businessVersion: 3,
        createdAt: now,
        completedAt: null
      }
    ],
    riskEvidence: [
      {
        id: 'REVD-001',
        alertId: 'RALT-001',
        sourceType: 'client',
        sourceId: 'CLI-001',
        kind: 'activity-log',
        summary: '活动日志',
        verified: true
      },
      {
        id: 'REVD-002',
        alertId: 'RALT-001',
        sourceType: 'client',
        sourceId: 'CLI-001',
        kind: 'identity-check',
        summary: '身份核查',
        verified: true
      },
      {
        id: 'REVD-003',
        alertId: 'RALT-002',
        sourceType: 'ib-project',
        sourceId: 'IBP-001',
        kind: 'project-metric',
        summary: '项目指标快照',
        verified: true
      },
      {
        id: 'REVD-004',
        alertId: null,
        sourceType: 'ib-project',
        sourceId: 'IBP-001',
        kind: 'review-note',
        summary: '项目复核说明',
        verified: true
      },
      {
        id: 'REVD-005',
        alertId: 'RALT-003',
        sourceType: 'client',
        sourceId: 'CLI-002',
        kind: 'activity-log',
        summary: '客户活动日志',
        verified: true
      },
      {
        id: 'REVD-006',
        alertId: 'RALT-003',
        sourceType: 'client',
        sourceId: 'CLI-002',
        kind: 'identity-check',
        summary: '身份复核材料',
        verified: true
      },
      {
        id: 'REVD-007',
        alertId: 'RALT-004',
        sourceType: 'ib-project',
        sourceId: 'IBP-002',
        kind: 'project-metric',
        summary: '项目指标材料',
        verified: true
      },
      {
        id: 'REVD-008',
        alertId: 'RALT-004',
        sourceType: 'ib-project',
        sourceId: 'IBP-002',
        kind: 'review-note',
        summary: '复核材料',
        verified: true
      },
      {
        id: 'REVD-009',
        alertId: 'RALT-005',
        sourceType: 'client',
        sourceId: 'CLI-003',
        kind: 'activity-log',
        summary: '活动记录',
        verified: true
      },
      {
        id: 'REVD-010',
        alertId: 'RALT-005',
        sourceType: 'client',
        sourceId: 'CLI-003',
        kind: 'identity-check',
        summary: '身份记录',
        verified: true
      },
      {
        id: 'REVD-011',
        alertId: null,
        sourceType: 'client',
        sourceId: 'CLI-001',
        kind: 'identity-check',
        summary: '未核验的材料',
        verified: false
      }
    ],
    riskInvestigations: [
      {
        id: 'RINV-001',
        alertId: 'RALT-003',
        investigatorId: 'EMP-005',
        evidenceIds: ['REVD-005', 'REVD-006'],
        analysis: '初版说明不够具体。',
        conclusion: 'false-positive',
        proposedDisposition: 'close',
        ruleVersion: 1,
        alertVersion: 3,
        recordedAt: now
      },
      {
        id: 'RINV-002',
        alertId: 'RALT-004',
        investigatorId: 'EMP-005',
        evidenceIds: ['REVD-007', 'REVD-008'],
        analysis: '项目指标需升级。',
        conclusion: 'confirmed',
        proposedDisposition: 'escalate',
        ruleVersion: 1,
        alertVersion: 3,
        recordedAt: now
      },
      {
        id: 'RINV-003',
        alertId: 'RALT-005',
        investigatorId: 'EMP-005',
        evidenceIds: ['REVD-009', 'REVD-010'],
        analysis: '核对后为误报。',
        conclusion: 'false-positive',
        proposedDisposition: 'close',
        ruleVersion: 1,
        alertVersion: 3,
        recordedAt: now
      }
    ],
    riskReviews: [
      {
        id: 'RREV-001',
        alertId: 'RALT-003',
        investigationId: 'RINV-001',
        reviewerId: 'EMP-004',
        decision: 'return',
        reason: '请补充具体分析。',
        alertVersion: 4,
        reviewedAt: now
      },
      {
        id: 'RREV-002',
        alertId: 'RALT-004',
        investigationId: 'RINV-002',
        reviewerId: 'EMP-004',
        decision: 'approve',
        reason: '同意按规则升级。',
        alertVersion: 4,
        reviewedAt: now
      }
    ],
    riskOperationRecords: [],
    institutionPolicy: { version: 1, maxMeetingMinutes: 120, serviceScope: 'research-roadshow' },
    institutionProfiles: [
      {
        id: 'INST-001',
        clientId: 'CLI-001',
        salesId: 'EMP-001',
        researchId: 'EMP-003',
        organizerId: 'EMP-002',
        projectId: 'PRJ-001',
        contactGroupId: 'CGROUP-001',
        scopes: ['research-roadshow'],
        policyVersion: 1
      }
    ],
    institutionMaterials: [
      {
        id: 'SMAT-001',
        title: '研究资料规范',
        documentId: 'DOC-002',
        documentVersion: 1,
        scope: 'research-roadshow'
      },
      { id: 'SMAT-002', title: '内部材料', documentId: 'DOC-002', documentVersion: 1, scope: 'internal' },
      {
        id: 'SMAT-003',
        title: '尚未批准的资料',
        documentId: 'DOC-001',
        documentVersion: 1,
        scope: 'research-roadshow'
      }
    ],
    institutionNeeds: [
      {
        id: 'SNEED-001',
        institutionId: 'INST-001',
        title: '机构研究路演需求',
        requestedMaterialIds: ['SMAT-001'],
        status: 'new',
        returnReason: null,
        roadshowId: null,
        businessVersion: 1,
        createdAt: now
      },
      {
        id: 'SNEED-002',
        institutionId: 'INST-001',
        title: '超范围资料需求',
        requestedMaterialIds: ['SMAT-002'],
        status: 'new',
        returnReason: null,
        roadshowId: null,
        businessVersion: 1,
        createdAt: now
      },
      {
        id: 'SNEED-003',
        institutionId: 'INST-001',
        title: '退回补正需求',
        requestedMaterialIds: ['SMAT-002'],
        status: 'returned',
        returnReason: '资料不在服务范围内，请改选已批准资料。',
        roadshowId: null,
        businessVersion: 2,
        createdAt: now
      }
    ],
    roadshows: [],
    institutionMaterialPackages: [],
    roadshowInvitations: [],
    institutionFollowups: [],
    institutionOperationRecords: [],
    todos: [
      {
        id: 'TODO-001',
        title: '审批出差申请',
        assigneeId: 'EMP-002',
        sourceType: 'form',
        sourceId: 'FORM-001',
        dueAt,
        status: 'open',
        completedAt: null
      },
      {
        id: 'OTODO-001',
        title: '研究文档复核',
        assigneeId: 'EMP-003',
        sourceType: 'document',
        sourceId: 'DOC-001',
        dueAt,
        status: 'open',
        completedAt: null
      },
      {
        id: 'OTODO-002',
        title: '审批逾期通用申请',
        assigneeId: 'EMP-002',
        sourceType: 'form',
        sourceId: 'OFFORM-001',
        dueAt: overdueAt,
        status: 'open',
        completedAt: null
      },
      {
        id: 'APPTODO-001',
        title: '审批办公用品申请',
        assigneeId: 'EMP-002',
        sourceType: 'approval',
        sourceId: 'APPR-001',
        dueAt,
        status: 'open',
        completedAt: null
      },
      {
        id: 'APPTODO-002',
        title: '审批资料补正申请',
        assigneeId: 'EMP-002',
        sourceType: 'approval',
        sourceId: 'APPR-002',
        dueAt,
        status: 'done',
        completedAt: now
      },
      {
        id: 'APPTODO-003',
        title: '审批已批准申请',
        assigneeId: 'EMP-002',
        sourceType: 'approval',
        sourceId: 'APPR-003',
        dueAt,
        status: 'done',
        completedAt: now
      }
    ],
    auditEntries: [],
    idempotencyRecords: [],
    attachmentJobs: []
  };
}
