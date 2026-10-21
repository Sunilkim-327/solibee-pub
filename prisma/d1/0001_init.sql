-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "fiscalStart" INTEGER NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "departmentId" TEXT,
    "clientPassEnabled" BOOLEAN NOT NULL DEFAULT false,
    "clientPassName" TEXT,
    "clientPassItemIds" TEXT,
    "seriesId" TEXT,
    "round" INTEGER,
    "closedAt" DATETIME,
    "closedBy" TEXT,
    "archivedAt" DATETIME,
    CONSTRAINT "Project_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Project_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ProjectSeries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ContractChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "signedAt" DATETIME NOT NULL,
    "amountDelta" BIGINT NOT NULL DEFAULT 0,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "extendedFrom" DATETIME,
    "managerId" TEXT,
    "carriedFromId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContractChange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContractChange_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChangeItem" (
    "changeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    PRIMARY KEY ("changeId", "itemId"),
    CONSTRAINT "ChangeItem_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "ContractChange" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChangeItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "parentId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "level" INTEGER,
    "externalId" TEXT,
    "externalSource" TEXT,
    "lastSyncedAt" DATETIME,
    "epsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "headId" TEXT,
    CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Department_headId_fkey" FOREIGN KEY ("headId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "loginId" TEXT,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "employeeNo" TEXT,
    "position" TEXT,
    "joinDate" DATETIME,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "tempPasswordExpiresAt" DATETIME,
    "deactivatedAt" DATETIME,
    "externalSource" TEXT,
    "employmentStatus" TEXT,
    "lastSyncedAt" DATETIME,
    "pmAutoGranted" BOOLEAN NOT NULL DEFAULT false,
    "authProvider" TEXT NOT NULL DEFAULT 'local',
    "externalId" TEXT,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPayer" BOOLEAN NOT NULL DEFAULT true,
    "isPm" BOOLEAN NOT NULL DEFAULT false,
    "leftAt" DATETIME,

    PRIMARY KEY ("projectId", "userId"),
    CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "code" TEXT,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountCode" TEXT,
    "keywords" TEXT,
    "perPersonLimit" INTEGER,
    "perCaseLimit" INTEGER,
    "hardBudget" BOOLEAN NOT NULL DEFAULT false,
    "needsAttendees" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "linkedItemId" TEXT,
    CONSTRAINT "Item_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Item_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "periods" INTEGER NOT NULL,
    "planned" BIGINT NOT NULL,
    "bundleItemIds" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "changeId" TEXT,
    CONSTRAINT "BudgetLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BudgetLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BudgetLine_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "ContractChange" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" BIGINT NOT NULL,
    "payMethod" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "headcount" INTEGER,
    "attendees" TEXT,
    "receiptUrl" TEXT,
    "merchant" TEXT,
    "hasExternal" BOOLEAN NOT NULL DEFAULT false,
    "flags" TEXT,
    "justification" TEXT,
    "isHq" BOOLEAN NOT NULL DEFAULT false,
    "changeId" TEXT,
    "yearMonth" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Expense_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "ContractChange" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Expense_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Expense_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonthlyClosing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "closedAt" DATETIME,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    CONSTRAINT "MonthlyClosing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MemberItem" (
    "projectId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "itemId"),
    CONSTRAINT "MemberItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemberItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DirectoryImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'soliday',
    "departments" TEXT NOT NULL,
    "employees" TEXT NOT NULL,
    "deptCount" INTEGER NOT NULL,
    "userCount" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" DATETIME
);

-- CreateTable
CREATE TABLE "UsedToken" (
    "jti" TEXT NOT NULL PRIMARY KEY,
    "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ClientPassUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "itemId" TEXT NOT NULL,
    "placeType" TEXT NOT NULL,
    "place" TEXT,
    "headcount" INTEGER,
    "memo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientPassUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientPassUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClientPassUsage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PassStatement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    CONSTRAINT "PassStatement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PassStatementLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "statementId" TEXT NOT NULL,
    "date" DATETIME,
    "holderName" TEXT NOT NULL,
    "holderKey" TEXT,
    "place" TEXT,
    "amount" BIGINT NOT NULL,
    "userId" TEXT,
    "memberClaim" TEXT,
    "memberNote" TEXT,
    "decision" TEXT,
    "usageItemId" TEXT,
    "decisionSource" TEXT,
    "decidedBy" TEXT,
    "decidedAt" DATETIME,
    "order" INTEGER NOT NULL DEFAULT 0,
    "time" TEXT,
    "cardNo" TEXT,
    "empNo" TEXT,
    "company" TEXT,
    "item" TEXT,
    "sheetName" TEXT,
    "placeType" TEXT,
    "onBehalfName" TEXT,
    "collectFrom" TEXT,
    "collectedAt" DATETIME,
    "collectNote" TEXT,
    "extra" TEXT,
    "matchKeys" TEXT,
    CONSTRAINT "PassStatementLine_usageItemId_fkey" FOREIGN KEY ("usageItemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PassStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "PassStatement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PassStatementLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PassHolder" (
    "projectId" TEXT NOT NULL,
    "holderKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "holderKey"),
    CONSTRAINT "PassHolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PassHolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PassImportProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "vendorName" TEXT,
    "periodStartDay" INTEGER NOT NULL DEFAULT 1,
    "sheets" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PassImportProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectPartner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectPartner_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_code_key" ON "Project"("code");

-- CreateIndex
CREATE INDEX "Project_parentId_idx" ON "Project"("parentId");

-- CreateIndex
CREATE INDEX "Project_seriesId_idx" ON "Project"("seriesId");

-- CreateIndex
CREATE INDEX "Project_departmentId_idx" ON "Project"("departmentId");

-- CreateIndex
CREATE INDEX "ContractChange_managerId_idx" ON "ContractChange"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractChange_projectId_seq_key" ON "ContractChange"("projectId", "seq");

-- CreateIndex
CREATE INDEX "ChangeItem_itemId_idx" ON "ChangeItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_externalId_key" ON "Department"("externalId");

-- CreateIndex
CREATE INDEX "Department_parentId_idx" ON "Department"("parentId");

-- CreateIndex
CREATE INDEX "Department_headId_idx" ON "Department"("headId");

-- CreateIndex
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeNo_key" ON "User"("employeeNo");

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE INDEX "Item_projectId_categoryId_order_idx" ON "Item"("projectId", "categoryId", "order");

-- CreateIndex
CREATE INDEX "BudgetLine_projectId_order_idx" ON "BudgetLine"("projectId", "order");

-- CreateIndex
CREATE INDEX "BudgetLine_itemId_idx" ON "BudgetLine"("itemId");

-- CreateIndex
CREATE INDEX "BudgetLine_changeId_idx" ON "BudgetLine"("changeId");

-- CreateIndex
CREATE INDEX "Expense_projectId_yearMonth_idx" ON "Expense"("projectId", "yearMonth");

-- CreateIndex
CREATE INDEX "Expense_projectId_itemId_idx" ON "Expense"("projectId", "itemId");

-- CreateIndex
CREATE INDEX "Expense_projectId_payerId_date_idx" ON "Expense"("projectId", "payerId", "date");

-- CreateIndex
CREATE INDEX "Expense_createdBy_createdAt_idx" ON "Expense"("createdBy", "createdAt");

-- CreateIndex
CREATE INDEX "Expense_itemId_idx" ON "Expense"("itemId");

-- CreateIndex
CREATE INDEX "Expense_changeId_idx" ON "Expense"("changeId");

-- CreateIndex
CREATE INDEX "Expense_payerId_idx" ON "Expense"("payerId");

-- CreateIndex
CREATE INDEX "MonthlyClosing_status_idx" ON "MonthlyClosing"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyClosing_projectId_yearMonth_key" ON "MonthlyClosing"("projectId", "yearMonth");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_createdAt_idx" ON "AuditLog"("entity", "createdAt");

-- CreateIndex
CREATE INDEX "MemberItem_itemId_idx" ON "MemberItem"("itemId");

-- CreateIndex
CREATE INDEX "ClientPassUsage_projectId_yearMonth_idx" ON "ClientPassUsage"("projectId", "yearMonth");

-- CreateIndex
CREATE INDEX "ClientPassUsage_projectId_userId_itemId_date_idx" ON "ClientPassUsage"("projectId", "userId", "itemId", "date");

-- CreateIndex
CREATE INDEX "ClientPassUsage_itemId_idx" ON "ClientPassUsage"("itemId");

-- CreateIndex
CREATE INDEX "ClientPassUsage_userId_idx" ON "ClientPassUsage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PassStatement_projectId_yearMonth_key" ON "PassStatement"("projectId", "yearMonth");

-- CreateIndex
CREATE INDEX "PassStatementLine_statementId_idx" ON "PassStatementLine"("statementId");

-- CreateIndex
CREATE INDEX "PassStatementLine_userId_idx" ON "PassStatementLine"("userId");

-- CreateIndex
CREATE INDEX "PassStatementLine_usageItemId_idx" ON "PassStatementLine"("usageItemId");

-- CreateIndex
CREATE INDEX "PassHolder_userId_idx" ON "PassHolder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PassImportProfile_projectId_key" ON "PassImportProfile"("projectId");

-- CreateIndex
CREATE INDEX "ProjectPartner_projectId_idx" ON "ProjectPartner"("projectId");

