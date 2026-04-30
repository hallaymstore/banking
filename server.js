require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/university_bank_simulator_pro';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-env';
const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@12345';
const BASE_CURRENCY = 'UZS';
const CURRENCIES = ['UZS', 'USD', 'EUR', 'RUB'];

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three')));
app.use(express.static(path.join(__dirname, 'public')));

const ROLE_PERMISSIONS = {
  admin: ['*'],
  director: [
    'view_dashboard', 'view_reports', 'manage_bank', 'manage_users', 'manage_clients', 'view_clients',
    'cash_ops', 'loan_ops', 'card_ops', 'fx_ops', 'payroll', 'queue_manage', 'simulation_manage', 'audit_view',
  ],
  cashier: ['view_dashboard', 'view_clients', 'cash_ops', 'queue_cash', 'queue_redirect'],
  credit_officer: ['view_dashboard', 'view_clients', 'manage_clients', 'loan_ops', 'queue_loan', 'queue_redirect'],
  card_operator: ['view_dashboard', 'view_clients', 'card_ops', 'queue_card', 'queue_redirect'],
  fx_operator: ['view_dashboard', 'view_clients', 'fx_ops', 'queue_fx', 'queue_redirect'],
  client_manager: ['view_dashboard', 'view_clients', 'manage_clients', 'queue_client', 'queue_redirect'],
  accountant: ['view_dashboard', 'view_reports', 'payroll', 'audit_view'],
  auditor: ['view_dashboard', 'view_reports', 'audit_view'],
};

const ROLE_LABELS = {
  admin: 'Bosh administrator',
  director: 'Bank direktori',
  cashier: 'Kassir',
  credit_officer: 'Kredit mutaxassisi',
  card_operator: 'Karta operatori',
  fx_operator: 'Valyuta operatori',
  client_manager: 'Mijozlar menejeri',
  accountant: 'Buxgalter',
  auditor: 'Auditor',
};

const SERVICE_TYPES = {
  cash: { label: 'Kassa', code: 'K', permission: 'cash_ops', queuePermission: 'queue_cash', targetRole: 'cashier' },
  loan: { label: 'Kredit', code: 'L', permission: 'loan_ops', queuePermission: 'queue_loan', targetRole: 'credit_officer' },
  card: { label: 'Karta', code: 'C', permission: 'card_ops', queuePermission: 'queue_card', targetRole: 'card_operator' },
  fx: { label: 'Valyuta', code: 'F', permission: 'fx_ops', queuePermission: 'queue_fx', targetRole: 'fx_operator' },
  client: { label: 'Mijozlar bo‘limi', code: 'M', permission: 'manage_clients', queuePermission: 'queue_client', targetRole: 'client_manager' },
  account: { label: 'Hisob raqam', code: 'A', permission: 'manage_clients', queuePermission: 'queue_client', targetRole: 'client_manager' },
  consulting: { label: 'Maslahat', code: 'S', permission: 'view_clients', queuePermission: 'queue_client', targetRole: 'client_manager' },
};

const QUESTIONS = {
  cash: ['Naqd pul kiritmoqchiman', 'Hisobdan pul yechmoqchiman', 'Pul o‘tkazmasi qilmoqchiman'],
  loan: ['Kredit olish shartlari qanday?', 'Kredit muddatini uzaytirish kerak', 'Kredit to‘lovini amalga oshiraman'],
  card: ['Plastik karta ochmoqchiman', 'Kartamni bloklash kerak', 'Karta limitini o‘zgartirmoqchiman'],
  fx: ['Dollarni so‘mga almashtirmoqchiman', 'Valyuta kursini bilmoqchiman', 'Euro hisobimga o‘tkazmoqchiman'],
  client: ['Yangi mijoz sifatida ro‘yxatdan o‘tmoqchiman', 'Ma’lumotlarimni yangilash kerak'],
  account: ['Hisob raqam ochish kerak', 'Jamg‘arma hisob ochmoqchiman'],
  consulting: ['Qaysi bo‘limga borishim kerak?', 'Bank xizmatlari haqida ma’lumot kerak'],
};

function hasPermission(user, permission) {
  if (!user) return false;
  const permissions = ROLE_PERMISSIONS[user.role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function canWorkService(user, serviceType) {
  if (!user || !SERVICE_TYPES[serviceType]) return false;
  const service = SERVICE_TYPES[serviceType];
  if (hasPermission(user, 'queue_manage')) return true;
  if (service.queuePermission && hasPermission(user, service.queuePermission)) return true;
  // view_clients is intentionally not enough to work a queue desk; otherwise every reader could see consulting queues.
  if (service.permission && service.permission !== 'view_clients' && hasPermission(user, service.permission)) return true;
  return false;
}

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: Object.keys(ROLE_PERMISSIONS), default: 'cashier' },
  phone: { type: String, default: '' },
  salary: { type: Number, default: 0, min: 0 },
  desk: { type: String, default: '' },
  status: { type: String, enum: ['active', 'blocked', 'deleted'], default: 'active' },
  lastLoginAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const bankStateSchema = new mongoose.Schema({
  name: { type: String, default: 'University Training Bank' },
  vaultBalance: { type: Number, default: 0 },
  reserveRequirementPercent: { type: Number, default: 18 },
  baseCurrency: { type: String, default: BASE_CURRENCY },
  rates: {
    UZS: { type: Number, default: 1 },
    USD: { type: Number, default: 12600 },
    EUR: { type: Number, default: 13700 },
    RUB: { type: Number, default: 135 },
  },
  tariffs: {
    transferFeePercent: { type: Number, default: 0.1 },
    exchangeFeePercent: { type: Number, default: 0.2 },
    cardIssueFee: { type: Number, default: 25000 },
    accountOpenFee: { type: Number, default: 0 },
    penaltyRatePercent: { type: Number, default: 0.5 },
  },
  policies: {
    maxCashWithdrawUZS: { type: Number, default: 50000000 },
    defaultLoanAnnualRate: { type: Number, default: 24 },
    maxLoanTermMonths: { type: Number, default: 60 },
    minLiquidityPercent: { type: Number, default: 25 },
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const clientSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  passport: { type: String, default: '', trim: true },
  pinfl: { type: String, default: '', trim: true },
  address: { type: String, default: '' },
  profession: { type: String, default: '' },
  segment: { type: String, enum: ['student', 'teacher', 'business', 'pensioner', 'vip', 'regular'], default: 'regular' },
  status: { type: String, enum: ['active', 'blocked', 'closed'], default: 'active' },
  riskLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  virtual: { type: Boolean, default: false },
  mood: { type: String, enum: ['calm', 'neutral', 'nervous', 'happy'], default: 'neutral' },
  currentLocation: { type: String, default: 'entrance' },
  clientUsername: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  clientPasswordHash: { type: String, default: '' },
  lastClientLoginAt: Date,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const accountSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  accountNumber: { type: String, unique: true, required: true },
  type: { type: String, enum: ['current', 'saving', 'salary', 'credit', 'deposit'], default: 'current' },
  currency: { type: String, enum: CURRENCIES, default: 'UZS' },
  balance: { type: Number, default: 0 },
  dailyLimit: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'blocked', 'closed'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const cardSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  cardNumber: { type: String, unique: true, required: true },
  type: { type: String, enum: ['HUMO', 'UZCARD', 'VISA', 'MASTERCARD'], default: 'HUMO' },
  limit: { type: Number, default: 0 },
  fee: { type: Number, default: 0 },
  expireMonth: { type: Number, default: 12 },
  expireYear: { type: Number, default: () => new Date().getFullYear() + 4 },
  status: { type: String, enum: ['active', 'blocked', 'closed'], default: 'active' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const transactionSchema = new mongoose.Schema({
  kind: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: CURRENCIES, default: 'UZS' },
  amountUZS: { type: Number, default: 0 },
  debitAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  creditAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  note: { type: String, default: '' },
  status: { type: String, enum: ['success', 'reversed'], default: 'success' },
  meta: { type: Object, default: {} },
}, { timestamps: true });

const loanSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  loanNumber: { type: String, unique: true, required: true },
  principal: { type: Number, required: true, min: 0 },
  outstanding: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: CURRENCIES, default: 'UZS' },
  annualRate: { type: Number, default: 24, min: 0 },
  termMonths: { type: Number, default: 12, min: 1 },
  dueDate: { type: Date, required: true },
  purpose: { type: String, default: '' },
  status: { type: String, enum: ['active', 'overdue', 'closed'], default: 'active' },
  payments: [{ amount: Number, interest: Number, principal: Number, paidAt: { type: Date, default: Date.now }, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, note: String }],
  extensions: [{ months: Number, previousDueDate: Date, newDueDate: Date, rateBefore: Number, rateAfter: Number, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now }, note: String }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const payrollRunSchema = new mongoose.Schema({
  month: { type: String, required: true },
  total: { type: Number, default: 0 },
  status: { type: String, enum: ['paid'], default: 'paid' },
  employees: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, fullName: String, role: String, salary: Number }],
  note: { type: String, default: '' },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const queueTicketSchema = new mongoose.Schema({
  ticketNo: { type: String, unique: true, required: true },
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  clientName: { type: String, default: '' },
  serviceType: { type: String, enum: Object.keys(SERVICE_TYPES), required: true },
  requestedOperation: { type: String, default: '' },
  question: { type: String, default: '' },
  priority: { type: String, enum: ['normal', 'student', 'vip', 'urgent'], default: 'normal' },
  status: { type: String, enum: ['waiting', 'called', 'serving', 'redirected', 'completed', 'cancelled'], default: 'waiting' },
  source: { type: String, default: 'reception' },
  targetRole: { type: String, default: '' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  calledAt: Date,
  completedAt: Date,
  currentLocation: { type: String, default: 'entrance' },
  routeHistory: [{ fromService: String, toService: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, reason: String, at: { type: Date, default: Date.now } }],
  visitPlan: [String],
  currentStep: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  virtual: { type: Boolean, default: false },
}, { timestamps: true });

const auditSchema = new mongoose.Schema({
  action: { type: String, required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  entity: { type: String, default: '' },
  entityId: { type: String, default: '' },
  ip: { type: String, default: '' },
  payload: { type: Object, default: {} },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const BankState = mongoose.model('BankState', bankStateSchema);
const Client = mongoose.model('Client', clientSchema);
const Account = mongoose.model('Account', accountSchema);
const Card = mongoose.model('Card', cardSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Loan = mongoose.model('Loan', loanSchema);
const PayrollRun = mongoose.model('PayrollRun', payrollRunSchema);
const QueueTicket = mongoose.model('QueueTicket', queueTicketSchema);
const AuditLog = mongoose.model('AuditLog', auditSchema);

function asyncHandler(fn) { return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next); }
function pick(obj, keys) { return Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]])); }
function positiveNumber(value, field = 'amount') {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`${field} musbat son bo'lishi kerak`);
    err.statusCode = 400;
    throw err;
  }
  return Math.round(n * 100) / 100;
}
function addMonths(date, months) { const d = new Date(date); d.setMonth(d.getMonth() + Number(months)); return d; }
async function getBankState() {
  let state = await BankState.findOne();
  if (!state) state = await BankState.create({ vaultBalance: 850000000 });
  state.rates = { UZS: 1, USD: Number(state.rates?.USD || 12600), EUR: Number(state.rates?.EUR || 13700), RUB: Number(state.rates?.RUB || 135) };
  if (!state.tariffs) state.tariffs = {};
  if (!state.policies) state.policies = {};
  return state;
}
function toUZS(amount, currency, rates) { return Math.round(Number(amount) * Number(rates?.[currency] || 1) * 100) / 100; }
function convert(amount, fromCurrency, toCurrency, rates) { const inUZS = toUZS(amount, fromCurrency, rates); return Math.round((inUZS / Number(rates?.[toCurrency] || 1)) * 100) / 100; }
function generateAccountNumber() { return `2026${crypto.randomInt(100000000000, 999999999999)}`; }
function generateLoanNumber() { return `LN-${Date.now()}-${crypto.randomInt(1000, 9999)}`; }
function generateCardNumber(type) { const prefixes = { HUMO: '9860', UZCARD: '8600', VISA: '4512', MASTERCARD: '5310' }; let raw = prefixes[type] || '9860'; while (raw.length < 16) raw += crypto.randomInt(0, 10).toString(); return raw.replace(/(.{4})/g, '$1 ').trim(); }
function dayKey() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }
async function generateTicketNo(serviceType) {
  const service = SERVICE_TYPES[serviceType] || SERVICE_TYPES.consulting;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const count = await QueueTicket.countDocuments({ createdAt: { $gte: today }, serviceType });
  return `${service.code}-${String(count + 1).padStart(3, '0')}`;
}
async function audit(req, action, entity = '', entityId = '', payload = {}) {
  try { await AuditLog.create({ action, actor: req.user?._id, entity, entityId: String(entityId || ''), ip: req.ip, payload }); } catch (_) {}
}
function publicUser(user) { return { id: user._id, fullName: user.fullName, username: user.username, role: user.role, roleLabel: ROLE_LABELS[user.role], permissions: ROLE_PERMISSIONS[user.role] || [], desk: user.desk, salary: user.salary }; }
function auth(required = true) {
  return asyncHandler(async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      if (!required) return next();
      return res.status(401).json({ message: 'Avval tizimga kiring' });
    }
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(payload.id).select('-passwordHash');
      if (!user || user.status !== 'active') return res.status(401).json({ message: 'Foydalanuvchi faol emas' });
      req.user = user;
      next();
    } catch (_) {
      return res.status(401).json({ message: 'Token noto‘g‘ri yoki eskirgan' });
    }
  });
}
function permit(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Avval tizimga kiring' });
    const ok = permissions.some(permission => hasPermission(req.user, permission));
    if (!ok) return res.status(403).json({ message: 'Bu amal uchun ruxsat yo‘q' });
    next();
  };
}
function permitService(serviceField = 'serviceType') {
  return (req, res, next) => {
    const serviceType = req.body[serviceField] || req.query[serviceField] || req.params[serviceField];
    if (!serviceType || !SERVICE_TYPES[serviceType]) return res.status(400).json({ message: 'Xizmat turi noto‘g‘ri' });
    if (!canWorkService(req.user, serviceType)) return res.status(403).json({ message: 'Bu xizmat navbati sizga tegishli emas' });
    next();
  };
}
async function ensureAccountUsable(accountId) {
  const account = await Account.findById(accountId);
  if (!account) { const err = new Error('Hisob topilmadi'); err.statusCode = 404; throw err; }
  if (account.status !== 'active') { const err = new Error('Hisob faol emas'); err.statusCode = 400; throw err; }
  return account;
}
async function createTransaction({ kind, amount, currency = 'UZS', debitAccount, creditAccount, client, performedBy, note = '', meta = {} }) {
  const state = await getBankState();
  return Transaction.create({ kind, amount, currency, amountUZS: toUZS(amount, currency, state.rates), debitAccount, creditAccount, client, performedBy, note, meta });
}
async function createTicket({ client, serviceType, requestedOperation = '', question = '', priority = 'normal', virtual = false, visitPlan = [], source = 'reception' }) {
  const service = SERVICE_TYPES[serviceType] || SERVICE_TYPES.consulting;
  const ticket = await QueueTicket.create({
    ticketNo: await generateTicketNo(serviceType),
    client: client?._id,
    clientName: client?.fullName || 'Mijoz',
    serviceType,
    requestedOperation,
    question: question || randomItem(QUESTIONS[serviceType] || QUESTIONS.consulting),
    priority,
    virtual,
    visitPlan: visitPlan.length ? visitPlan : [serviceType],
    targetRole: service.targetRole,
    currentLocation: 'waiting_hall',
    source,
  });
  if (client) await Client.findByIdAndUpdate(client._id, { currentLocation: 'waiting_hall' });
  return ticket;
}
function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomPhone() { return `+998${randomItem(['90','91','93','94','95','97','99'])}${crypto.randomInt(1000000, 9999999)}`; }
function randomPassport() { return `${randomItem(['AA','AB','AC','AD'])}${crypto.randomInt(1000000, 9999999)}`; }
function randomPINFL() { return `${crypto.randomInt(10000000000000, 99999999999999)}`; }
function serviceForRole(role) {
  return Object.keys(SERVICE_TYPES).filter(k => SERVICE_TYPES[k].targetRole === role || (role === 'client_manager' && ['client','account','consulting'].includes(k)));
}

function visibleTransactionKinds(user) {
  if (!user) return new Set();
  if (hasPermission(user, 'view_reports') || hasPermission(user, 'audit_view') || hasPermission(user, 'manage_bank')) return '*';
  const kinds = new Set();
  if (hasPermission(user, 'cash_ops')) ['deposit', 'withdrawal', 'transfer', 'loan_payment'].forEach(k => kinds.add(k));
  if (hasPermission(user, 'loan_ops')) ['loan_disbursement', 'loan_payment', 'loan_extension', 'loan_add_funds'].forEach(k => kinds.add(k));
  if (hasPermission(user, 'card_ops')) ['card_issue_fee'].forEach(k => kinds.add(k));
  if (hasPermission(user, 'fx_ops')) ['exchange'].forEach(k => kinds.add(k));
  if (hasPermission(user, 'manage_clients')) ['initial_deposit'].forEach(k => kinds.add(k));
  if (hasPermission(user, 'payroll')) ['salary_distribution'].forEach(k => kinds.add(k));
  return kinds;
}
function canSeeTransaction(user, trx) {
  const kinds = visibleTransactionKinds(user);
  if (kinds === '*') return true;
  return kinds.has(trx.kind) || String(trx.performedBy?._id || trx.performedBy || '') === String(user?._id || '');
}
function visibleServicesFor(user) {
  if (!user) return [];
  return Object.keys(SERVICE_TYPES).filter(serviceType => canWorkService(user, serviceType));
}

async function seedDefaultUsers() {
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);
  const defaults = [
    { fullName: 'Bosh administrator', username: DEFAULT_ADMIN_USERNAME, role: 'admin', salary: 0, desk: 'Admin' },
    { fullName: 'Dilshod Karimov', username: 'cashier', role: 'cashier', salary: 4500000, desk: 'Kassa-1' },
    { fullName: 'Madina Rasulova', username: 'credit', role: 'credit_officer', salary: 5600000, desk: 'Kredit-1' },
    { fullName: 'Aziza Sobirova', username: 'card', role: 'card_operator', salary: 4300000, desk: 'Karta-1' },
    { fullName: 'Sardor Aliyev', username: 'fx', role: 'fx_operator', salary: 4800000, desk: 'Valyuta-1' },
    { fullName: 'Gulnoza Toirova', username: 'manager', role: 'client_manager', salary: 4700000, desk: 'Mijozlar-1' },
    { fullName: 'Javlon Bekmurodov', username: 'accountant', role: 'accountant', salary: 6200000, desk: 'Buxgalteriya' },
    { fullName: 'Nodir Auditor', username: 'auditor', role: 'auditor', salary: 5200000, desk: 'Audit' },
    { fullName: 'Bank direktori', username: 'director', role: 'director', salary: 9000000, desk: 'Direktor' },
  ];
  for (const u of defaults) {
    const exists = await User.findOne({ username: u.username });
    if (!exists) await User.create({ ...u, passwordHash });
  }
}
async function seedVirtualClients(target = 25) {
  const current = await Client.countDocuments({ virtual: true });
  if (current >= target) return { created: 0, total: current };
  const first = ['Aziz', 'Madina', 'Dilnoza', 'Jasur', 'Bekzod', 'Sevara', 'Jamshid', 'Lola', 'Sardor', 'Malika', 'Farruh', 'Nilufar', 'Shahzod', 'Diyor', 'Gulnoza', 'Zarina', 'Sherzod', 'Komila', 'Oybek', 'Mohira'];
  const last = ['Karimov', 'Rasulova', 'Aliyev', 'Sobirov', 'Nazarov', 'Toshmatova', 'Qodirov', 'Ergasheva', 'Xolmatov', 'Mirzayeva', 'Saidov', 'Islomova'];
  const professions = ['talaba', 'o‘qituvchi', 'dasturchi', 'tadbirkor', 'shifokor', 'haydovchi', 'buxgalter', 'muhandis'];
  const needed = target - current;
  let created = 0;
  for (let i = 0; i < needed; i++) {
    const client = await Client.create({
      fullName: `${randomItem(first)} ${randomItem(last)}`,
      phone: randomPhone(),
      passport: randomPassport(),
      pinfl: randomPINFL(),
      address: `Toshkent shahri, ${crypto.randomInt(1, 12)}-mavze`,
      profession: randomItem(professions),
      segment: randomItem(['student', 'teacher', 'business', 'regular', 'regular']),
      riskLevel: randomItem(['low', 'low', 'medium']),
      virtual: true,
      mood: randomItem(['calm', 'neutral', 'happy', 'nervous']),
      currentLocation: 'entrance',
    });
    const account = await Account.create({ client: client._id, accountNumber: generateAccountNumber(), type: randomItem(['current','salary','saving']), currency: 'UZS', balance: crypto.randomInt(100000, 15000000) });
    if (i % 3 === 0) await Card.create({ client: client._id, account: account._id, type: randomItem(['HUMO','UZCARD']), limit: 2000000, fee: 0, cardNumber: generateCardNumber('HUMO') });
    created++;
  }
  return { created, total: target };
}
async function ensureInitialData() {
  await seedDefaultUsers();
  await getBankState();
  await seedVirtualClients(25);
  await ensureDemoClientLogins();
}
function randomVisitPlan() {
  return randomItem([
    ['consulting', 'cash'], ['client', 'account', 'card'], ['cash'], ['loan', 'cash'], ['fx', 'cash'], ['card'], ['loan'], ['account', 'cash'], ['consulting', 'fx'],
  ]);
}


const CLIENT_DEFAULT_PASSWORD = process.env.CLIENT_DEFAULT_PASSWORD || 'Client@123';
const GAME_WORLD = { width: 2200, height: 1450 };
const GAME_ROOMS = [
  { id: 'outside', label: 'Tashqi kirish', x: 70, y: 1040, w: 2060, h: 320 },
  { id: 'entrance', label: 'Vestibyul', x: 890, y: 900, w: 420, h: 110 },
  { id: 'reception', label: 'Resepshn', x: 890, y: 760, w: 420, h: 120 },
  { id: 'waiting_hall', label: 'Kutish zali', x: 500, y: 720, w: 340, h: 320 },
  { id: 'central_hall', label: 'Markaziy zal', x: 880, y: 620, w: 440, h: 360 },
  { id: 'cash_room', label: 'Kassa xonasi', x: 460, y: 390, w: 350, h: 220 },
  { id: 'credit_room', label: 'Kredit ofisi', x: 860, y: 390, w: 410, h: 220 },
  { id: 'card_room', label: 'Karta bo‘limi', x: 1320, y: 390, w: 350, h: 220 },
  { id: 'fx_room', label: 'Valyuta bo‘limi', x: 1720, y: 390, w: 350, h: 220 },
  { id: 'manager_room', label: 'Direktor xonasi', x: 860, y: 150, w: 410, h: 180 },
  { id: 'lounge', label: 'Hamkasblar lounge', x: 460, y: 150, w: 350, h: 180 },
  { id: 'archive', label: 'Arxiv', x: 1720, y: 150, w: 350, h: 180 },
  { id: 'client_room', label: 'Mijozlar servisi', x: 1320, y: 720, w: 750, h: 320 },
];
const GAME_DESKS = {
  entrance: { label: 'Bank entrance', x: 1100, y: 1210, room: 'outside' },
  reception: { label: 'Terminal', x: 1100, y: 815, room: 'reception' },
  waiting: { label: 'Kutish zali', x: 670, y: 875, room: 'waiting_hall' },
  cash: { label: 'Kassa-1', x: 635, y: 505, room: 'cash_room', serviceType: 'cash', targetRole: 'cashier' },
  loan: { label: 'Kredit-1', x: 1060, y: 505, room: 'credit_room', serviceType: 'loan', targetRole: 'credit_officer' },
  card: { label: 'Karta-1', x: 1495, y: 505, room: 'card_room', serviceType: 'card', targetRole: 'card_operator' },
  fx: { label: 'Valyuta-1', x: 1890, y: 505, room: 'fx_room', serviceType: 'fx', targetRole: 'fx_operator' },
  client: { label: 'Mijoz-1', x: 1510, y: 860, room: 'client_room', serviceType: 'client', targetRole: 'client_manager' },
  account: { label: 'Hisob stol', x: 1635, y: 860, room: 'client_room', serviceType: 'account', targetRole: 'client_manager' },
  consulting: { label: 'Maslahat stoli', x: 1760, y: 860, room: 'client_room', serviceType: 'consulting', targetRole: 'client_manager' },
  lounge: { label: 'Hamkasblar stoli', x: 650, y: 245, room: 'lounge' },
  archive: { label: 'Arxiv javoni', x: 1890, y: 245, room: 'archive' },
};
const GAME_NPCS = [
  { id: 'guard', name: 'Qo‘riqchi Botir', role: 'security', emoji: '🛡️', x: 1100, y: 1160, targetX: 1100, targetY: 1160, action: 'Kirish zonasi nazoratda', message: 'Xush kelibsiz. Ichkariga kiring yoki terminaldan navbat oling.' },
  { id: 'receptionist', name: 'Resepshn Lola', role: 'reception', emoji: '💁‍♀️', x: 1115, y: 805, targetX: 1115, targetY: 805, action: 'Mijozlarni yo‘naltiryapti', message: 'Savolingiz bo‘lsa, navbat turini tanlang.' },
  { id: 'mentor', name: 'Mentor Aziz', role: 'mentor', emoji: '👨‍🏫', x: 1010, y: 240, targetX: 1010, targetY: 240, action: 'Amaliyotni kuzatyapti', message: 'Rolga mos ishlash va muloqot madaniyati baholanadi.' },
  { id: 'consultant', name: 'Maslahatchi Sevara', role: 'guide', emoji: '🤝', x: 1600, y: 840, targetX: 1600, targetY: 840, action: 'Mijozlar savollariga javob beryapti', message: 'Karta, hisob va maslahat xizmatlari shu bo‘limda.' },
  { id: 'cleaner', name: 'Xizmatchi Otabek', role: 'support', emoji: '🧹', x: 690, y: 225, targetX: 690, targetY: 225, action: 'Lounge hududini tartibga keltiryapti', message: 'Iltimos, joylarni toza saqlang.' },
];
const gamePlayers = new Map();
const gameVoiceMessages = [];
let gameVoiceSeq = 1;
function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }
function gameDeskForService(serviceType) { return GAME_DESKS[serviceType] || GAME_DESKS.consulting; }
function gameSpawn(actor) {
  if (actor.kind === 'staff') {
    const roleService = serviceForRole(actor.role)[0];
    const desk = gameDeskForService(roleService);
    return { x: desk?.x || 1088, y: desk?.y || 615, room: desk?.room || 'lounge' };
  }
  return { x: 88, y: 382, room: 'entrance' };
}
function gameEmoji(actor) {
  if (actor.kind === 'client') return '🧍';
  return ({ admin: '🧑‍💻', director: '🧑‍💼', cashier: '💵', credit_officer: '📑', card_operator: '💳', fx_operator: '💱', client_manager: '🤝', accountant: '🧾', auditor: '🔎' })[actor.role] || '🧑‍💼';
}
function gamePublicPlayer(player) {
  return {
    id: player.id, kind: player.kind, name: player.name, role: player.role, roleLabel: player.roleLabel,
    emoji: player.emoji, avatarType: player.avatarType || player.role || player.kind,
    x: player.x, y: player.y, targetX: player.targetX, targetY: player.targetY, angle: Number(player.angle || 0),
    room: player.room, action: player.action, message: player.message, pose: player.pose || 'idle',
    gesture: player.gesture || '', speaking: Boolean(player.speaking) && (!player.speakingUntil || Date.now() < Number(player.speakingUntil)), mood: player.mood || 'neutral', updatedAt: player.updatedAt,
  };
}
function updateGamePlayer(actor, patch = {}) {
  const key = `${actor.kind}:${actor.id}`;
  const spawn = gameSpawn(actor);
  const prev = gamePlayers.get(key) || {
    id: key, kind: actor.kind, sourceId: String(actor.id), name: actor.name, role: actor.role,
    roleLabel: actor.roleLabel || (actor.kind === 'client' ? 'Mijoz' : ROLE_LABELS[actor.role] || actor.role),
    emoji: gameEmoji(actor), avatarType: actor.role || actor.kind, x: spawn.x, y: spawn.y, targetX: spawn.x, targetY: spawn.y,
    angle: actor.kind === 'staff' ? -Math.PI / 2 : 0, room: spawn.room,
    action: actor.kind === 'client' ? 'Bankka kirdi' : 'Ish joyida', message: '', pose: 'idle', gesture: '', speaking: false,
  };
  const merged = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  merged.x = clamp(merged.x, 20, GAME_WORLD.width - 40);
  merged.y = clamp(merged.y, 50, GAME_WORLD.height - 50);
  merged.targetX = clamp(merged.targetX ?? merged.x, 20, GAME_WORLD.width - 40);
  merged.targetY = clamp(merged.targetY ?? merged.y, 50, GAME_WORLD.height - 50);
  merged.angle = Number.isFinite(Number(merged.angle)) ? Number(merged.angle) : Number(prev.angle || 0);
  if (merged.speakingUntil && Date.now() > Number(merged.speakingUntil)) merged.speaking = false;
  gamePlayers.set(key, merged);
  return merged;
}
function cleanupGamePlayers() {
  const cutoff = Date.now() - 45 * 1000;
  for (const [key, player] of gamePlayers.entries()) {
    if (!player.updatedAt || new Date(player.updatedAt).getTime() < cutoff) gamePlayers.delete(key);
  }
}
function ticketNpc(ticket, index = 0) {
  const service = SERVICE_TYPES[ticket.serviceType] || SERVICE_TYPES.consulting;
  let desk = GAME_DESKS.waiting;
  if (['called', 'serving'].includes(ticket.status)) desk = gameDeskForService(ticket.serviceType);
  if (ticket.status === 'completed') desk = GAME_DESKS.entrance;
  const waitingOffset = ticket.status === 'waiting' || ticket.status === 'redirected' ? index * 18 : 0;
  return {
    id: `ticket:${ticket._id}`,
    kind: 'npc',
    name: ticket.clientName || ticket.client?.fullName || 'Mijoz',
    role: 'queue_client', roleLabel: service.label, emoji: ticket.priority === 'vip' ? '🧑‍💼' : ticket.priority === 'student' ? '🎓' : '🧍',
    x: ticket.status === 'waiting' || ticket.status === 'redirected' ? 560 + (index % 5) * 42 : desk.x - 38,
    y: ticket.status === 'waiting' || ticket.status === 'redirected' ? 820 + Math.floor(index / 5) * 44 : desk.y + 35,
    targetX: desk.x - 38,
    targetY: desk.y + 35,
    angle: ticket.status === 'waiting' || ticket.status === 'redirected' ? Math.PI / 2 : -Math.PI / 2,
    room: desk.room,
    action: `${ticket.ticketNo} · ${service.label} · ${ticket.status}`,
    message: ticket.question || '',
    pose: ticket.status === 'serving' ? 'explain' : ticket.status === 'called' ? 'wave' : 'idle',
    gesture: ticket.status === 'called' ? 'wave' : '',
    ticketId: String(ticket._id),
    serviceType: ticket.serviceType,
    status: ticket.status,
    updatedAt: ticket.updatedAt,
  };
}
async function authGame(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Avval tizimga kiring' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.scope === 'client') {
      const client = await Client.findById(payload.id);
      if (!client || client.status !== 'active') return res.status(401).json({ message: 'Mijoz profili faol emas' });
      req.client = client;
      req.gameActor = { kind: 'client', id: client._id, name: client.fullName, role: 'client', roleLabel: 'Mijoz' };
      return next();
    }
    const user = await User.findById(payload.id).select('-passwordHash');
    if (!user || user.status !== 'active') return res.status(401).json({ message: 'Foydalanuvchi faol emas' });
    req.user = user;
    req.gameActor = { kind: 'staff', id: user._id, name: user.fullName, role: user.role, roleLabel: ROLE_LABELS[user.role] };
    next();
  } catch (_) {
    return res.status(401).json({ message: 'Token noto‘g‘ri yoki eskirgan' });
  }
}
async function ensureDemoClientLogins() {
  const demos = [
    { username: 'client1', fullName: 'Aziz Talaba', segment: 'student', mood: 'happy' },
    { username: 'client2', fullName: 'Malika Karimova', segment: 'regular', mood: 'neutral' },
    { username: 'client3', fullName: 'Jasur Startup', segment: 'business', mood: 'calm' },
    { username: 'vipclient', fullName: 'Dilnoza VIP', segment: 'vip', mood: 'happy' },
  ];
  const passwordHash = await bcrypt.hash(CLIENT_DEFAULT_PASSWORD, 12);
  for (const d of demos) {
    let client = await Client.findOne({ clientUsername: d.username });
    if (!client) {
      client = await Client.create({
        fullName: d.fullName, clientUsername: d.username, clientPasswordHash: passwordHash, phone: randomPhone(), passport: randomPassport(), pinfl: randomPINFL(),
        address: 'Virtual filial', profession: d.segment === 'student' ? 'talaba' : 'mijoz', segment: d.segment, riskLevel: 'low', virtual: false,
        mood: d.mood, currentLocation: 'entrance',
      });
      await Account.create({ client: client._id, accountNumber: generateAccountNumber(), type: 'current', currency: 'UZS', balance: crypto.randomInt(250000, 6500000) });
    } else if (!client.clientPasswordHash) {
      client.clientPasswordHash = passwordHash;
      await client.save();
    }
  }
}

app.get('/', (req, res) => res.redirect('/login.html'));


app.post('/api/client/register', asyncHandler(async (req, res) => {
  const { fullName, username, password, phone = '', segment = 'student' } = req.body;
  const cleanUsername = String(username || '').toLowerCase().trim();
  if (!fullName || !cleanUsername || !password) return res.status(400).json({ message: 'F.I.Sh, login va parol majburiy' });
  if (cleanUsername.length < 3) return res.status(400).json({ message: 'Login kamida 3 ta belgidan iborat bo‘lsin' });
  const exists = await Client.findOne({ clientUsername: cleanUsername });
  if (exists) return res.status(409).json({ message: 'Bu mijoz logini band' });
  const client = await Client.create({
    fullName, phone, clientUsername: cleanUsername, clientPasswordHash: await bcrypt.hash(String(password), 12),
    segment: ['student', 'teacher', 'business', 'pensioner', 'vip', 'regular'].includes(segment) ? segment : 'student',
    virtual: false, mood: 'happy', currentLocation: 'entrance', profession: segment === 'student' ? 'talaba' : '',
  });
  await Account.create({ client: client._id, accountNumber: generateAccountNumber(), type: 'current', currency: 'UZS', balance: 250000 });
  const token = jwt.sign({ id: client._id, scope: 'client' }, JWT_SECRET, { expiresIn: '12h' });
  res.status(201).json({ token, client: { id: client._id, fullName: client.fullName, username: client.clientUsername, segment: client.segment }, startPage: '/game.html' });
}));
app.post('/api/client/login', asyncHandler(async (req, res) => {
  const username = String(req.body.username || '').toLowerCase().trim();
  const client = await Client.findOne({ clientUsername: username, status: 'active' });
  if (!client || !client.clientPasswordHash) return res.status(401).json({ message: 'Mijoz logini yoki parol noto‘g‘ri' });
  const ok = await bcrypt.compare(String(req.body.password || ''), client.clientPasswordHash);
  if (!ok) return res.status(401).json({ message: 'Mijoz logini yoki parol noto‘g‘ri' });
  client.lastClientLoginAt = new Date();
  client.currentLocation = 'entrance';
  await client.save();
  const token = jwt.sign({ id: client._id, scope: 'client' }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, client: { id: client._id, fullName: client.fullName, username: client.clientUsername, segment: client.segment, mood: client.mood }, startPage: '/game.html' });
}));
app.get('/api/client/me', authGame, asyncHandler(async (req, res) => {
  if (!req.client) return res.status(403).json({ message: 'Bu endpoint faqat mijozlar uchun' });
  const [accounts, cards, loans, tickets] = await Promise.all([
    Account.find({ client: req.client._id }).sort({ createdAt: -1 }).limit(20),
    Card.find({ client: req.client._id }).populate('account', 'accountNumber currency balance').sort({ createdAt: -1 }).limit(20),
    Loan.find({ client: req.client._id }).populate('account', 'accountNumber currency balance').sort({ createdAt: -1 }).limit(20),
    QueueTicket.find({ client: req.client._id }).sort({ createdAt: -1 }).limit(10),
  ]);
  res.json({ client: req.client, accounts, cards, loans, tickets });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username: String(username || '').toLowerCase().trim(), status: 'active' });
  if (!user) return res.status(401).json({ message: 'Login yoki parol noto‘g‘ri' });
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Login yoki parol noto‘g‘ri' });
  user.lastLoginAt = new Date();
  await user.save();
  const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: publicUser(user), startPage: ['admin', 'director'].includes(user.role) ? '/admin.html' : '/staff.html' });
}));
app.get('/api/auth/me', auth(), (req, res) => res.json({ user: publicUser(req.user), roles: ROLE_LABELS, permissionsMap: ROLE_PERMISSIONS, services: SERVICE_TYPES, currencies: CURRENCIES }));
app.get('/api/config/roles', auth(), (req, res) => res.json({ roles: ROLE_LABELS, permissions: ROLE_PERMISSIONS, services: SERVICE_TYPES, currencies: CURRENCIES }));

app.get('/api/dashboard', auth(), permit('view_dashboard', 'view_reports'), asyncHandler(async (req, res) => {
  const state = await getBankState();
  const [users, clients, accounts, cards, loans, transactions, payrolls, queue, virtualClients] = await Promise.all([
    User.find({ status: { $ne: 'deleted' } }).select('-passwordHash').sort({ createdAt: -1 }).limit(300),
    Client.find().sort({ createdAt: -1 }).limit(600),
    Account.find().populate('client', 'fullName phone segment').sort({ createdAt: -1 }).limit(1200),
    Card.find().populate('client', 'fullName').populate('account', 'accountNumber currency balance').sort({ createdAt: -1 }).limit(500),
    Loan.find().populate('client', 'fullName phone').populate('account', 'accountNumber currency balance').sort({ createdAt: -1 }).limit(500),
    Transaction.find().populate('performedBy', 'fullName role').populate('client', 'fullName').sort({ createdAt: -1 }).limit(60),
    PayrollRun.find().sort({ createdAt: -1 }).limit(12),
    QueueTicket.find({ status: { $in: ['waiting','called','serving','redirected'] } }).populate('client', 'fullName mood currentLocation segment').populate('assignedTo', 'fullName role desk').sort({ createdAt: 1 }).limit(100),
    Client.find({ virtual: true }).sort({ updatedAt: -1 }).limit(40),
  ]);
  const accountBalancesUZS = accounts.reduce((s, a) => s + toUZS(a.balance, a.currency, state.rates), 0);
  const activeLoanOutstandingUZS = loans.filter(l => l.status !== 'closed').reduce((s, l) => s + toUZS(l.outstanding, l.currency, state.rates), 0);
  const payrollExpense = payrolls.reduce((s, p) => s + p.total, 0);
  const totalInterestPaid = loans.reduce((s, l) => s + (l.payments || []).reduce((ps, p) => ps + Number(p.interest || 0), 0), 0);
  const requiredReserve = accountBalancesUZS * Number(state.reserveRequirementPercent || 0) / 100;
  const liquidityRatio = accountBalancesUZS > 0 ? (state.vaultBalance / accountBalancesUZS) * 100 : 100;
  const profitLike = state.vaultBalance + activeLoanOutstandingUZS - accountBalancesUZS - payrollExpense;
  let health = 'ijobiy';
  if (liquidityRatio < Number(state.policies?.minLiquidityPercent || 25) || profitLike < 0) health = 'salbiy';
  else if (liquidityRatio < Number(state.policies?.minLiquidityPercent || 25) + 15) health = 'ehtiyotkor';
  const today = new Date(); today.setHours(0,0,0,0);
  const todayQueue = await QueueTicket.aggregate([{ $match: { createdAt: { $gte: today } } }, { $group: { _id: '$serviceType', count: { $sum: 1 } } }]);
  const last30 = await Transaction.aggregate([
    { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, status: 'success' } },
    { $group: { _id: '$kind', totalUZS: { $sum: '$amountUZS' }, count: { $sum: 1 } } },
    { $sort: { totalUZS: -1 } },
  ]);
  const bankWide = hasPermission(req.user, 'view_reports') || hasPermission(req.user, 'audit_view') || hasPermission(req.user, 'manage_bank') || hasPermission(req.user, 'queue_manage');
  const visibleQueue = bankWide ? queue : queue.filter(q => canWorkService(req.user, q.serviceType));
  const visibleTransactions = transactions.filter(t => canSeeTransaction(req.user, t));
  const visibleTodayQueue = bankWide ? todayQueue : todayQueue.filter(x => canWorkService(req.user, x._id));
  const metrics = {
    employees: users.length, activeEmployees: users.filter(u => u.status === 'active').length, clients: clients.length,
    virtualClients: virtualClients.length, accounts: accounts.length, cards: cards.length, activeLoans: loans.filter(l => l.status !== 'closed').length,
    queueWaiting: visibleQueue.filter(q => q.status === 'waiting').length, queueServing: visibleQueue.filter(q => ['called','serving'].includes(q.status)).length,
    vaultBalance: Math.round(state.vaultBalance), customerBalancesUZS: Math.round(accountBalancesUZS), loanPortfolioUZS: Math.round(activeLoanOutstandingUZS), requiredReserve: Math.round(requiredReserve),
    totalInterestPaid: Math.round(totalInterestPaid), payrollExpense: Math.round(payrollExpense), liquidityRatio: Math.round(liquidityRatio * 10) / 10, bankHealth: health, profitLike: Math.round(profitLike),
  };
  res.json({
    state,
    metrics,
    users: bankWide ? users : [],
    clients: bankWide ? clients : [],
    accounts: bankWide ? accounts : [],
    cards: bankWide ? cards : [],
    loans: bankWide ? loans : [],
    transactions: visibleTransactions,
    payrolls: bankWide ? payrolls : [],
    queue: visibleQueue,
    virtualClients: bankWide ? virtualClients : [],
    last30: bankWide ? last30 : [],
    todayQueue: visibleTodayQueue,
  });
}));

app.get('/api/users', auth(), permit('manage_users', 'payroll', 'view_reports', 'audit_view'), asyncHandler(async (req, res) => res.json(await User.find({ status: { $ne: 'deleted' } }).select('-passwordHash').sort({ createdAt: -1 }))));
app.post('/api/users', auth(), permit('manage_users'), asyncHandler(async (req, res) => {
  const { fullName, username, password, role, phone, salary, desk } = req.body;
  if (!fullName || !username || !password) return res.status(400).json({ message: 'Ism, login va parol majburiy' });
  if (!ROLE_PERMISSIONS[role]) return res.status(400).json({ message: 'Rol noto‘g‘ri' });
  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = await User.create({ fullName, username, passwordHash, role, phone, salary: Number(salary || 0), desk, createdBy: req.user._id });
  await audit(req, 'user_create', 'User', user._id, { username, role });
  res.status(201).json({ ...user.toObject(), passwordHash: undefined });
}));
app.put('/api/users/:id', auth(), permit('manage_users'), asyncHandler(async (req, res) => {
  const patch = pick(req.body, ['fullName', 'role', 'phone', 'salary', 'status', 'desk']);
  if (patch.role && !ROLE_PERMISSIONS[patch.role]) return res.status(400).json({ message: 'Rol noto‘g‘ri' });
  if (req.body.password) patch.passwordHash = await bcrypt.hash(String(req.body.password), 12);
  const user = await User.findByIdAndUpdate(req.params.id, patch, { new: true }).select('-passwordHash');
  if (!user) return res.status(404).json({ message: 'Xodim topilmadi' });
  await audit(req, 'user_update', 'User', user._id, patch);
  res.json(user);
}));
app.delete('/api/users/:id', auth(), permit('manage_users'), asyncHandler(async (req, res) => {
  if (String(req.user._id) === String(req.params.id)) return res.status(400).json({ message: 'O‘zingizni o‘chira olmaysiz' });
  const user = await User.findByIdAndUpdate(req.params.id, { status: 'deleted' }, { new: true }).select('-passwordHash');
  if (!user) return res.status(404).json({ message: 'Xodim topilmadi' });
  await audit(req, 'user_delete', 'User', user._id, {});
  res.json({ message: 'Xodim o‘chirildi', user });
}));

app.get('/api/bank', auth(), permit('view_dashboard', 'view_reports'), asyncHandler(async (req, res) => res.json(await getBankState())));
app.put('/api/bank/capital', auth(), permit('manage_bank'), asyncHandler(async (req, res) => {
  const { mode = 'set', amount, note = '' } = req.body;
  const n = Number(amount);
  if (!Number.isFinite(n)) return res.status(400).json({ message: 'Miqdor noto‘g‘ri' });
  const state = await getBankState();
  const before = state.vaultBalance;
  state.vaultBalance = mode === 'adjust' ? state.vaultBalance + n : n;
  state.updatedBy = req.user._id;
  await state.save();
  await createTransaction({ kind: 'capital_adjust', amount: Math.abs(state.vaultBalance - before), currency: 'UZS', performedBy: req.user._id, note, meta: { mode, before, after: state.vaultBalance } });
  await audit(req, 'capital_update', 'BankState', state._id, { before, after: state.vaultBalance, mode });
  res.json(state);
}));
app.put('/api/bank/rates', auth(), permit('manage_bank', 'fx_ops'), asyncHandler(async (req, res) => {
  const state = await getBankState();
  for (const c of CURRENCIES) if (req.body[c] !== undefined) {
    const v = Number(req.body[c]); if (!Number.isFinite(v) || v <= 0) return res.status(400).json({ message: `${c} kursi noto‘g‘ri` }); state.rates[c] = v;
  }
  state.rates.UZS = 1; state.updatedBy = req.user._id; await state.save();
  await audit(req, 'rates_update', 'BankState', state._id, state.rates);
  res.json(state);
}));
app.put('/api/bank/policies', auth(), permit('manage_bank'), asyncHandler(async (req, res) => {
  const state = await getBankState();
  state.reserveRequirementPercent = Number(req.body.reserveRequirementPercent ?? state.reserveRequirementPercent);
  state.tariffs = { ...state.tariffs.toObject?.() || state.tariffs, ...pick(req.body.tariffs || req.body, ['transferFeePercent','exchangeFeePercent','cardIssueFee','accountOpenFee','penaltyRatePercent']) };
  state.policies = { ...state.policies.toObject?.() || state.policies, ...pick(req.body.policies || req.body, ['maxCashWithdrawUZS','defaultLoanAnnualRate','maxLoanTermMonths','minLiquidityPercent']) };
  state.updatedBy = req.user._id;
  await state.save();
  await audit(req, 'policies_update', 'BankState', state._id, { tariffs: state.tariffs, policies: state.policies });
  res.json(state);
}));

app.get('/api/clients', auth(), permit('view_clients', 'manage_clients', 'view_reports'), asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = q ? { $or: [{ fullName: new RegExp(q, 'i') }, { phone: new RegExp(q, 'i') }, { passport: new RegExp(q, 'i') }, { pinfl: new RegExp(q, 'i') }] } : {};
  res.json(await Client.find(filter).sort({ createdAt: -1 }).limit(500));
}));
app.post('/api/clients', auth(), permit('manage_clients'), asyncHandler(async (req, res) => {
  const { fullName, phone, passport, pinfl, address, riskLevel, segment, profession } = req.body;
  if (!fullName) return res.status(400).json({ message: 'Mijoz F.I.Sh majburiy' });
  const client = await Client.create({ fullName, phone, passport, pinfl, address, riskLevel, segment, profession, createdBy: req.user._id });
  await audit(req, 'client_create', 'Client', client._id, { fullName });
  res.status(201).json(client);
}));
app.put('/api/clients/:id', auth(), permit('manage_clients'), asyncHandler(async (req, res) => {
  const client = await Client.findByIdAndUpdate(req.params.id, pick(req.body, ['fullName','phone','passport','pinfl','address','status','riskLevel','segment','profession','mood','currentLocation']), { new: true });
  if (!client) return res.status(404).json({ message: 'Mijoz topilmadi' });
  await audit(req, 'client_update', 'Client', client._id, req.body);
  res.json(client);
}));

app.get('/api/accounts', auth(), permit('view_clients', 'manage_clients', 'view_reports'), asyncHandler(async (req, res) => {
  const filter = req.query.client ? { client: req.query.client } : {};
  res.json(await Account.find(filter).populate('client', 'fullName phone passport segment').sort({ createdAt: -1 }).limit(700));
}));
app.post('/api/accounts', auth(), permit('manage_clients'), asyncHandler(async (req, res) => {
  const { clientId, type = 'current', currency = 'UZS', initialBalance = 0 } = req.body;
  const client = await Client.findById(clientId);
  if (!client) return res.status(404).json({ message: 'Mijoz topilmadi' });
  if (!CURRENCIES.includes(currency)) return res.status(400).json({ message: 'Valyuta noto‘g‘ri' });
  const state = await getBankState();
  const balance = Number(initialBalance || 0);
  const fee = Number(state.tariffs?.accountOpenFee || 0);
  const account = await Account.create({ client: client._id, type, currency, balance, accountNumber: generateAccountNumber(), createdBy: req.user._id });
  if (balance > 0) state.vaultBalance += toUZS(balance, currency, state.rates);
  if (fee > 0) state.vaultBalance += fee;
  await state.save();
  if (balance > 0) await createTransaction({ kind: 'initial_deposit', amount: balance, currency, creditAccount: account._id, client: client._id, performedBy: req.user._id, note: 'Hisob ochilishidagi boshlang‘ich qoldiq' });
  await audit(req, 'account_create', 'Account', account._id, { client: client._id, currency, type });
  res.status(201).json(await account.populate('client', 'fullName phone passport'));
}));
app.put('/api/accounts/:id/status', auth(), permit('manage_clients'), asyncHandler(async (req, res) => {
  if (!['active','blocked','closed'].includes(req.body.status)) return res.status(400).json({ message: 'Status noto‘g‘ri' });
  const account = await Account.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }).populate('client', 'fullName');
  if (!account) return res.status(404).json({ message: 'Hisob topilmadi' });
  await audit(req, 'account_status', 'Account', account._id, { status: req.body.status });
  res.json(account);
}));

app.post('/api/operations/deposit', auth(), permit('cash_ops'), asyncHandler(async (req, res) => {
  const amount = positiveNumber(req.body.amount);
  const account = await ensureAccountUsable(req.body.accountId);
  const state = await getBankState();
  account.balance += amount; state.vaultBalance += toUZS(amount, account.currency, state.rates);
  await account.save(); await state.save();
  const trx = await createTransaction({ kind: 'deposit', amount, currency: account.currency, creditAccount: account._id, client: account.client, performedBy: req.user._id, note: req.body.note || 'Naqd pul kirim' });
  res.json({ account, trx, state });
}));
app.post('/api/operations/withdraw', auth(), permit('cash_ops'), asyncHandler(async (req, res) => {
  const amount = positiveNumber(req.body.amount);
  const account = await ensureAccountUsable(req.body.accountId);
  const state = await getBankState();
  const uzs = toUZS(amount, account.currency, state.rates);
  if (uzs > Number(state.policies?.maxCashWithdrawUZS || Infinity)) return res.status(400).json({ message: 'Kunlik yechish limiti oshib ketdi' });
  if (account.balance < amount) return res.status(400).json({ message: 'Mijoz hisobida mablag‘ yetarli emas' });
  if (state.vaultBalance < uzs) return res.status(400).json({ message: 'Bank kassasida mablag‘ yetarli emas' });
  account.balance -= amount; state.vaultBalance -= uzs;
  await account.save(); await state.save();
  const trx = await createTransaction({ kind: 'withdrawal', amount, currency: account.currency, debitAccount: account._id, client: account.client, performedBy: req.user._id, note: req.body.note || 'Naqd pul chiqim' });
  res.json({ account, trx, state });
}));
app.post('/api/operations/transfer', auth(), permit('cash_ops'), asyncHandler(async (req, res) => {
  const amount = positiveNumber(req.body.amount);
  const from = await ensureAccountUsable(req.body.fromAccountId);
  const to = await ensureAccountUsable(req.body.toAccountId);
  if (String(from._id) === String(to._id)) return res.status(400).json({ message: 'Bir xil hisob tanlangan' });
  if (from.currency !== to.currency) return res.status(400).json({ message: 'Turli valyuta uchun valyuta ayirboshlash amalidan foydalaning' });
  if (from.balance < amount) return res.status(400).json({ message: 'Mablag‘ yetarli emas' });
  const state = await getBankState();
  const fee = Math.round(amount * Number(state.tariffs?.transferFeePercent || 0) / 100 * 100) / 100;
  const totalDebit = amount + fee;
  if (from.balance < totalDebit) return res.status(400).json({ message: 'Komissiya bilan mablag‘ yetarli emas' });
  from.balance -= totalDebit; to.balance += amount; state.vaultBalance += toUZS(fee, from.currency, state.rates);
  await from.save(); await to.save(); await state.save();
  const trx = await createTransaction({ kind: 'transfer', amount, currency: from.currency, debitAccount: from._id, creditAccount: to._id, client: from.client, performedBy: req.user._id, note: req.body.note || 'Hisobdan hisobga o‘tkazma', meta: { fee } });
  res.json({ from, to, fee, trx, state });
}));
app.post('/api/operations/exchange', auth(), permit('fx_ops'), asyncHandler(async (req, res) => {
  const amount = positiveNumber(req.body.amount);
  const from = await ensureAccountUsable(req.body.fromAccountId);
  const to = await ensureAccountUsable(req.body.toAccountId);
  if (String(from._id) === String(to._id)) return res.status(400).json({ message: 'Bir xil hisob tanlangan' });
  if (from.balance < amount) return res.status(400).json({ message: 'Mablag‘ yetarli emas' });
  const state = await getBankState();
  const converted = convert(amount, from.currency, to.currency, state.rates);
  const feePercent = Number(req.body.feePercent ?? state.tariffs?.exchangeFeePercent ?? 0.2);
  const fee = Math.round(converted * feePercent) / 100;
  const net = Math.max(0, Math.round((converted - fee) * 100) / 100);
  from.balance -= amount; to.balance += net; state.vaultBalance += toUZS(fee, to.currency, state.rates);
  await from.save(); await to.save(); await state.save();
  const trx = await createTransaction({ kind: 'exchange', amount, currency: from.currency, debitAccount: from._id, creditAccount: to._id, client: from.client, performedBy: req.user._id, note: req.body.note || 'Valyuta ayirboshlash', meta: { fromCurrency: from.currency, toCurrency: to.currency, converted, fee, net, feePercent } });
  res.json({ from, to, converted, fee, net, trx, state });
}));

app.get('/api/cards', auth(), permit('card_ops', 'view_reports'), asyncHandler(async (req, res) => {
  const filter = req.query.client ? { client: req.query.client } : {};
  res.json(await Card.find(filter).populate('client', 'fullName phone').populate('account', 'accountNumber currency balance').sort({ createdAt: -1 }).limit(500));
}));
app.post('/api/cards', auth(), permit('card_ops'), asyncHandler(async (req, res) => {
  const { clientId, accountId, type = 'HUMO', limit = 0 } = req.body;
  const client = await Client.findById(clientId);
  const account = await ensureAccountUsable(accountId);
  if (!client) return res.status(404).json({ message: 'Mijoz topilmadi' });
  if (String(account.client) !== String(client._id)) return res.status(400).json({ message: 'Hisob bu mijozga tegishli emas' });
  const state = await getBankState();
  const feeAmount = Number(req.body.fee ?? state.tariffs?.cardIssueFee ?? 0);
  if (feeAmount > 0) {
    if (account.balance < feeAmount) return res.status(400).json({ message: 'Karta chiqarish komissiyasi uchun mablag‘ yetarli emas' });
    account.balance -= feeAmount; state.vaultBalance += toUZS(feeAmount, account.currency, state.rates);
    await account.save(); await state.save();
    await createTransaction({ kind: 'card_issue_fee', amount: feeAmount, currency: account.currency, debitAccount: account._id, client: client._id, performedBy: req.user._id, note: 'Karta chiqarish komissiyasi' });
  }
  const card = await Card.create({ client: client._id, account: account._id, type, limit: Number(limit || 0), fee: feeAmount, cardNumber: generateCardNumber(type), createdBy: req.user._id });
  await audit(req, 'card_create', 'Card', card._id, { type, client: client._id });
  res.status(201).json(await card.populate([{ path: 'client', select: 'fullName phone' }, { path: 'account', select: 'accountNumber currency balance' }]));
}));
app.put('/api/cards/:id/status', auth(), permit('card_ops'), asyncHandler(async (req, res) => {
  if (!['active','blocked','closed'].includes(req.body.status)) return res.status(400).json({ message: 'Status noto‘g‘ri' });
  const card = await Card.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true }).populate('client', 'fullName').populate('account', 'accountNumber currency balance');
  if (!card) return res.status(404).json({ message: 'Karta topilmadi' });
  await audit(req, 'card_status', 'Card', card._id, { status: req.body.status });
  res.json(card);
}));

app.get('/api/loans', auth(), permit('loan_ops', 'view_reports'), asyncHandler(async (req, res) => {
  const filter = req.query.client ? { client: req.query.client } : {};
  res.json(await Loan.find(filter).populate('client', 'fullName phone passport').populate('account', 'accountNumber currency balance').sort({ createdAt: -1 }).limit(500));
}));
app.post('/api/loans', auth(), permit('loan_ops'), asyncHandler(async (req, res) => {
  const principal = positiveNumber(req.body.principal, 'Kredit miqdori');
  const account = await ensureAccountUsable(req.body.accountId);
  const client = await Client.findById(req.body.clientId);
  if (!client) return res.status(404).json({ message: 'Mijoz topilmadi' });
  if (String(account.client) !== String(client._id)) return res.status(400).json({ message: 'Hisob bu mijozga tegishli emas' });
  const state = await getBankState();
  const uzs = toUZS(principal, account.currency, state.rates);
  if (state.vaultBalance < uzs) return res.status(400).json({ message: 'Bank mablag‘i kredit berish uchun yetarli emas' });
  const termMonths = Number(req.body.termMonths || 12);
  if (termMonths > Number(state.policies?.maxLoanTermMonths || 60)) return res.status(400).json({ message: 'Kredit muddati siyosat limitidan yuqori' });
  account.balance += principal; state.vaultBalance -= uzs;
  await account.save(); await state.save();
  const annualRate = Number(req.body.annualRate || state.policies?.defaultLoanAnnualRate || 24);
  const loan = await Loan.create({ client: client._id, account: account._id, loanNumber: generateLoanNumber(), principal, outstanding: principal, currency: account.currency, annualRate, termMonths, dueDate: addMonths(new Date(), termMonths), purpose: req.body.purpose || '', createdBy: req.user._id });
  await createTransaction({ kind: 'loan_disbursement', amount: principal, currency: account.currency, creditAccount: account._id, client: client._id, performedBy: req.user._id, note: req.body.purpose || 'Kredit ajratildi', meta: { loan: loan._id } });
  res.status(201).json(await loan.populate([{ path: 'client', select: 'fullName phone passport' }, { path: 'account', select: 'accountNumber currency balance' }]));
}));
app.post('/api/loans/:id/pay', auth(), permit('loan_ops', 'cash_ops'), asyncHandler(async (req, res) => {
  const amount = positiveNumber(req.body.amount, 'To‘lov');
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Kredit topilmadi' });
  if (loan.status === 'closed') return res.status(400).json({ message: 'Kredit allaqachon yopilgan' });
  const account = await ensureAccountUsable(loan.account);
  if (account.balance < amount) return res.status(400).json({ message: 'Mijoz hisobida to‘lov uchun mablag‘ yetarli emas' });
  const monthlyInterest = Math.round((loan.outstanding * (loan.annualRate / 100 / 12)) * 100) / 100;
  const interest = Math.min(amount, monthlyInterest);
  const principalPart = Math.min(loan.outstanding, Math.max(0, Math.round((amount - interest) * 100) / 100));
  const realPayment = Math.round((interest + principalPart) * 100) / 100;
  const state = await getBankState();
  account.balance -= realPayment; loan.outstanding = Math.round((loan.outstanding - principalPart) * 100) / 100;
  if (loan.outstanding <= 0.01) { loan.outstanding = 0; loan.status = 'closed'; }
  loan.payments.push({ amount: realPayment, interest, principal: principalPart, by: req.user._id, note: req.body.note || '' });
  state.vaultBalance += toUZS(realPayment, loan.currency, state.rates);
  await account.save(); await loan.save(); await state.save();
  const trx = await createTransaction({ kind: 'loan_payment', amount: realPayment, currency: loan.currency, debitAccount: account._id, client: loan.client, performedBy: req.user._id, note: req.body.note || 'Kredit to‘lovi', meta: { loan: loan._id, interest, principal: principalPart } });
  res.json({ loan: await loan.populate([{ path: 'client', select: 'fullName phone' }, { path: 'account', select: 'accountNumber currency balance' }]), account, trx, state });
}));
app.post('/api/loans/:id/extend', auth(), permit('loan_ops'), asyncHandler(async (req, res) => {
  const months = Number(req.body.months || 0);
  if (!Number.isFinite(months) || months <= 0) return res.status(400).json({ message: 'Muddat oyda musbat kiritilishi kerak' });
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Kredit topilmadi' });
  const state = await getBankState();
  if (loan.termMonths + months > Number(state.policies?.maxLoanTermMonths || 60)) return res.status(400).json({ message: 'Umumiy kredit muddati limitdan oshadi' });
  const previousDueDate = loan.dueDate; const rateBefore = loan.annualRate;
  if (req.body.newAnnualRate !== undefined) loan.annualRate = Number(req.body.newAnnualRate);
  loan.termMonths += months; loan.dueDate = addMonths(loan.dueDate, months);
  loan.extensions.push({ months, previousDueDate, newDueDate: loan.dueDate, rateBefore, rateAfter: loan.annualRate, by: req.user._id, note: req.body.note || '' });
  await loan.save();
  await createTransaction({ kind: 'loan_extension', amount: 0, currency: loan.currency, client: loan.client, performedBy: req.user._id, note: req.body.note || 'Kredit muddati uzaytirildi', meta: { loan: loan._id, months } });
  res.json(await loan.populate([{ path: 'client', select: 'fullName phone' }, { path: 'account', select: 'accountNumber currency balance' }]));
}));
app.post('/api/loans/:id/add-funds', auth(), permit('loan_ops'), asyncHandler(async (req, res) => {
  const amount = positiveNumber(req.body.amount, 'Qo‘shimcha kredit');
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Kredit topilmadi' });
  if (loan.status === 'closed') return res.status(400).json({ message: 'Yopilgan kreditga pul qo‘shib bo‘lmaydi' });
  const account = await ensureAccountUsable(loan.account);
  const state = await getBankState();
  const uzs = toUZS(amount, loan.currency, state.rates);
  if (state.vaultBalance < uzs) return res.status(400).json({ message: 'Bank mablag‘i yetarli emas' });
  account.balance += amount; loan.principal += amount; loan.outstanding += amount; state.vaultBalance -= uzs;
  await account.save(); await loan.save(); await state.save();
  const trx = await createTransaction({ kind: 'loan_add_funds', amount, currency: loan.currency, creditAccount: account._id, client: loan.client, performedBy: req.user._id, note: req.body.note || 'Kreditga qo‘shimcha mablag‘', meta: { loan: loan._id } });
  res.json({ loan, account, trx, state });
}));

app.post('/api/payroll/run', auth(), permit('payroll'), asyncHandler(async (req, res) => {
  const month = req.body.month || new Date().toISOString().slice(0, 7);
  const ids = Array.isArray(req.body.employeeIds) ? req.body.employeeIds : null;
  const filter = ids?.length ? { _id: { $in: ids }, status: 'active' } : { status: 'active', salary: { $gt: 0 } };
  const employees = await User.find(filter).select('-passwordHash');
  const total = employees.reduce((s, e) => s + Number(e.salary || 0), 0);
  const state = await getBankState();
  if (total <= 0) return res.status(400).json({ message: 'To‘lanadigan oylik yo‘q' });
  if (state.vaultBalance < total) return res.status(400).json({ message: 'Bank mablag‘i oylik to‘lash uchun yetarli emas' });
  state.vaultBalance -= total; await state.save();
  const run = await PayrollRun.create({ month, total, employees: employees.map(e => ({ user: e._id, fullName: e.fullName, role: e.role, salary: Number(e.salary || 0) })), note: req.body.note || '', performedBy: req.user._id });
  await createTransaction({ kind: 'salary_distribution', amount: total, currency: 'UZS', performedBy: req.user._id, note: `${month} oyliklari taqsimlandi`, meta: { payrollRun: run._id, employees: employees.length } });
  res.status(201).json({ run, state });
}));
app.get('/api/payroll', auth(), permit('payroll', 'view_reports'), asyncHandler(async (req, res) => res.json(await PayrollRun.find().populate('performedBy', 'fullName role').sort({ createdAt: -1 }).limit(100))));

app.get('/api/queue', auth(), permit('view_dashboard', 'queue_manage', 'cash_ops', 'loan_ops', 'card_ops', 'fx_ops', 'manage_clients'), asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  else filter.status = { $in: ['waiting','called','serving','redirected'] };
  if (req.query.serviceType) filter.serviceType = req.query.serviceType;
  const all = await QueueTicket.find(filter).populate('client', 'fullName phone mood currentLocation segment').populate('assignedTo', 'fullName role desk').sort({ priority: -1, createdAt: 1 }).limit(250);
  const visible = hasPermission(req.user, 'queue_manage') ? all : all.filter(t => canWorkService(req.user, t.serviceType));
  res.json(visible);
}));
app.post('/api/queue', auth(), permit('queue_manage', 'manage_clients', 'cash_ops', 'loan_ops', 'card_ops', 'fx_ops'), asyncHandler(async (req, res) => {
  const { clientId, serviceType = 'consulting', requestedOperation, question, priority = 'normal' } = req.body;
  if (!SERVICE_TYPES[serviceType]) return res.status(400).json({ message: 'Xizmat turi noto‘g‘ri' });
  if (!hasPermission(req.user, 'queue_manage') && !canWorkService(req.user, serviceType)) return res.status(403).json({ message: 'Bu xizmat navbatini yaratish uchun ruxsat yo‘q' });
  const client = clientId ? await Client.findById(clientId) : null;
  if (clientId && !client) return res.status(404).json({ message: 'Mijoz topilmadi' });
  const ticket = await createTicket({ client, serviceType, requestedOperation, question, priority, source: 'manual' });
  await audit(req, 'queue_create', 'QueueTicket', ticket._id, { serviceType, clientId });
  res.status(201).json(await ticket.populate('client', 'fullName phone mood'));
}));
app.post('/api/queue/call-next', auth(), asyncHandler(async (req, res) => {
  if (req.body.serviceType && !SERVICE_TYPES[req.body.serviceType]) return res.status(400).json({ message: 'Xizmat turi noto‘g‘ri' });
  if (req.body.serviceType && !canWorkService(req.user, req.body.serviceType)) return res.status(403).json({ message: 'Bu xizmat navbati sizga tegishli emas' });
  const services = req.body.serviceType ? [req.body.serviceType] : visibleServicesFor(req.user);
  if (!services.length) return res.status(403).json({ message: 'Sizga biriktirilgan navbat yo‘q' });
  const ticket = await QueueTicket.findOne({ serviceType: { $in: services }, status: { $in: ['waiting','redirected'] } }).sort({ priority: -1, createdAt: 1 });
  if (!ticket) return res.status(404).json({ message: 'Kutayotgan mijoz yo‘q' });
  ticket.status = 'called'; ticket.assignedTo = req.user._id; ticket.calledAt = new Date(); ticket.currentLocation = req.user.desk || SERVICE_TYPES[ticket.serviceType].label;
  await ticket.save();
  if (ticket.client) await Client.findByIdAndUpdate(ticket.client, { currentLocation: ticket.currentLocation });
  await audit(req, 'queue_call', 'QueueTicket', ticket._id, { ticketNo: ticket.ticketNo });
  res.json(await ticket.populate([{ path: 'client', select: 'fullName phone mood currentLocation segment' }, { path: 'assignedTo', select: 'fullName role desk' }]));
}));
app.post('/api/queue/:id/start', auth(), asyncHandler(async (req, res) => {
  const ticket = await QueueTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ message: 'Navbat topilmadi' });
  if (!canWorkService(req.user, ticket.serviceType)) return res.status(403).json({ message: 'Bu navbat sizga tegishli emas' });
  ticket.status = 'serving'; ticket.assignedTo = req.user._id; ticket.currentLocation = req.user.desk || SERVICE_TYPES[ticket.serviceType].label;
  await ticket.save();
  if (ticket.client) await Client.findByIdAndUpdate(ticket.client, { currentLocation: ticket.currentLocation });
  res.json(await ticket.populate([{ path: 'client', select: 'fullName phone mood currentLocation segment' }, { path: 'assignedTo', select: 'fullName role desk' }]));
}));
app.post('/api/queue/:id/redirect', auth(), asyncHandler(async (req, res) => {
  const { toServiceType, reason = '' } = req.body;
  if (!SERVICE_TYPES[toServiceType]) return res.status(400).json({ message: 'Yo‘naltirish bo‘limi noto‘g‘ri' });
  const ticket = await QueueTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ message: 'Navbat topilmadi' });
  if (!canWorkService(req.user, ticket.serviceType) && !hasPermission(req.user, 'queue_manage')) return res.status(403).json({ message: 'Bu navbatni yo‘naltira olmaysiz' });
  const fromService = ticket.serviceType;
  ticket.routeHistory.push({ fromService, toService: toServiceType, by: req.user._id, reason });
  ticket.serviceType = toServiceType; ticket.targetRole = SERVICE_TYPES[toServiceType].targetRole; ticket.status = 'redirected'; ticket.assignedTo = undefined; ticket.currentLocation = 'waiting_hall'; ticket.question = reason || ticket.question;
  await ticket.save();
  if (ticket.client) await Client.findByIdAndUpdate(ticket.client, { currentLocation: 'waiting_hall' });
  await audit(req, 'queue_redirect', 'QueueTicket', ticket._id, { fromService, toServiceType, reason });
  res.json(await ticket.populate('client', 'fullName phone mood currentLocation'));
}));
app.post('/api/queue/:id/complete', auth(), asyncHandler(async (req, res) => {
  const ticket = await QueueTicket.findById(req.params.id);
  if (!ticket) return res.status(404).json({ message: 'Navbat topilmadi' });
  if (!canWorkService(req.user, ticket.serviceType) && !hasPermission(req.user, 'queue_manage')) return res.status(403).json({ message: 'Bu navbat sizga tegishli emas' });
  ticket.status = 'completed'; ticket.completedAt = new Date(); ticket.notes = req.body.notes || ticket.notes; ticket.currentLocation = 'exit';
  await ticket.save();
  if (ticket.client) await Client.findByIdAndUpdate(ticket.client, { currentLocation: 'exit' });
  await audit(req, 'queue_complete', 'QueueTicket', ticket._id, { ticketNo: ticket.ticketNo });
  res.json(ticket);
}));

app.post('/api/simulation/seed-clients', auth(), permit('simulation_manage', 'manage_bank'), asyncHandler(async (req, res) => {
  const count = Math.min(50, Math.max(20, Number(req.body.count || 25)));
  res.json(await seedVirtualClients(count));
}));
app.post('/api/simulation/generate-queue', auth(), permit('simulation_manage', 'manage_bank', 'queue_manage'), asyncHandler(async (req, res) => {
  const amount = Math.min(30, Math.max(1, Number(req.body.amount || 10)));
  const clients = await Client.find({ virtual: true }).sort({ updatedAt: 1 }).limit(amount * 2);
  const created = [];
  for (let i = 0; i < Math.min(amount, clients.length); i++) {
    const plan = randomVisitPlan();
    created.push(await createTicket({ client: clients[i], serviceType: plan[0], requestedOperation: plan.join(' → '), question: randomItem(QUESTIONS[plan[0]] || QUESTIONS.consulting), priority: clients[i].segment === 'vip' ? 'vip' : clients[i].segment === 'student' ? 'student' : 'normal', virtual: true, visitPlan: plan, source: 'simulation' }));
  }
  await audit(req, 'simulation_queue_generate', 'QueueTicket', '', { amount: created.length });
  res.status(201).json(created);
}));
app.post('/api/simulation/tick', auth(), permit('simulation_manage', 'manage_bank', 'queue_manage'), asyncHandler(async (req, res) => {
  const completed = await QueueTicket.find({ status: 'completed', virtual: true, currentStep: { $lt: 10 } }).populate('client').limit(10);
  const moved = [];
  for (const t of completed) {
    const nextStep = Number(t.currentStep || 0) + 1;
    const nextService = t.visitPlan?.[nextStep];
    t.currentStep = nextStep; await t.save();
    if (nextService) moved.push(await createTicket({ client: t.client, serviceType: nextService, requestedOperation: t.visitPlan.join(' → '), question: randomItem(QUESTIONS[nextService] || QUESTIONS.consulting), priority: t.priority, virtual: true, visitPlan: t.visitPlan, source: 'simulation_next' }));
  }
  res.json({ moved });
}));
app.get('/api/simulation/visitors', auth(), permit('view_dashboard'), asyncHandler(async (req, res) => {
  const clients = await Client.find({ virtual: true }).sort({ updatedAt: -1 }).limit(40);
  const tickets = await QueueTicket.find({ virtual: true, status: { $in: ['waiting','called','serving','redirected'] } }).populate('client', 'fullName mood currentLocation segment').populate('assignedTo', 'fullName role desk').sort({ updatedAt: -1 }).limit(80);
  res.json({ clients, tickets });
}));



function purgeGameVoiceMessages() {
  const cutoff = Date.now() - 60 * 1000;
  while (gameVoiceMessages.length && gameVoiceMessages[0].ts < cutoff) gameVoiceMessages.shift();
  if (gameVoiceMessages.length > 80) gameVoiceMessages.splice(0, gameVoiceMessages.length - 80);
}
function voicePublic(msg) {
  return {
    seq: msg.seq, fromId: msg.fromId, fromName: msg.fromName, roleLabel: msg.roleLabel,
    x: msg.x, y: msg.y, radius: msg.radius, mime: msg.mime, audio: msg.audio, ts: msg.ts,
  };
}

app.get('/api/game/voice', authGame, asyncHandler(async (req, res) => {
  purgeGameVoiceMessages();
  updateGamePlayer(req.gameActor);
  const after = Number(req.query.after || 0);
  const meKey = `${req.gameActor.kind}:${req.gameActor.id}`;
  res.json({ messages: gameVoiceMessages.filter(m => m.seq > after && m.fromId !== meKey).map(voicePublic), serverSeq: gameVoiceSeq - 1 });
}));
app.post('/api/game/voice', authGame, asyncHandler(async (req, res) => {
  const audio = String(req.body.audio || '');
  const mime = String(req.body.mime || 'audio/webm').slice(0, 80);
  if (!audio.startsWith('data:audio/')) return res.status(400).json({ message: 'Audio format noto‘g‘ri' });
  if (audio.length > 1400000) return res.status(413).json({ message: 'Voice chunk juda katta. Qisqaroq gapiring.' });
  const player = updateGamePlayer(req.gameActor, { speaking: true, speakingUntil: Date.now() + 1800, pose: 'talk', gesture: 'explain', action: 'Mikrofonda gapiryapti' });
  const msg = {
    seq: gameVoiceSeq++, fromId: player.id, fromName: player.name, roleLabel: player.roleLabel,
    x: player.x, y: player.y, radius: Number(req.body.radius || 360), mime, audio, ts: Date.now(),
  };
  gameVoiceMessages.push(msg);
  purgeGameVoiceMessages();
  res.status(201).json({ message: 'Voice yuborildi', seq: msg.seq });
}));

app.get('/api/game/state', authGame, asyncHandler(async (req, res) => {
  cleanupGamePlayers();
  updateGamePlayer(req.gameActor);
  const activeTickets = await QueueTicket.find({ status: { $in: ['waiting', 'called', 'serving', 'redirected'] } })
    .populate('client', 'fullName mood currentLocation segment')
    .populate('assignedTo', 'fullName role desk')
    .sort({ priority: -1, createdAt: 1 })
    .limit(120);
  const players = [...gamePlayers.values()].map(gamePublicPlayer);
  const ticketNpcs = activeTickets.map((ticket, index) => ticketNpc(ticket, index));
  const myTickets = req.client ? await QueueTicket.find({ client: req.client._id }).sort({ createdAt: -1 }).limit(8) : [];
  const visibleTickets = req.user ? activeTickets.filter(t => hasPermission(req.user, 'queue_manage') || canWorkService(req.user, t.serviceType)) : myTickets;
  res.json({
    world: GAME_WORLD,
    rooms: GAME_ROOMS,
    desks: GAME_DESKS,
    services: SERVICE_TYPES,
    roles: ROLE_LABELS,
    actor: req.gameActor,
    me: gamePublicPlayer(updateGamePlayer(req.gameActor)),
    players,
    npcs: [...GAME_NPCS, ...ticketNpcs],
    tickets: visibleTickets,
    myTickets,
    allowedServices: req.user ? visibleServicesFor(req.user) : Object.keys(SERVICE_TYPES),
  });
}));
app.post('/api/game/move', authGame, asyncHandler(async (req, res) => {
  const x = clamp(req.body.x, 20, GAME_WORLD.width - 40);
  const y = clamp(req.body.y, 50, GAME_WORLD.height - 50);
  const room = String(req.body.room || 'floor').slice(0, 40);
  const angle = Number(req.body.angle || 0);
  const pose = String(req.body.pose || 'walk').slice(0, 24);
  const gesture = String(req.body.gesture || '').slice(0, 24);
  const player = updateGamePlayer(req.gameActor, { x, y, targetX: x, targetY: y, angle, pose, gesture, room, action: req.body.action || 'Yuryapti' });
  if (req.client) await Client.findByIdAndUpdate(req.client._id, { currentLocation: room });
  res.json({ player: gamePublicPlayer(player) });
}));
app.post('/api/game/action', authGame, asyncHandler(async (req, res) => {
  const type = String(req.body.type || '');
  const actor = req.gameActor;
  if (type === 'talk') {
    const message = String(req.body.message || '').trim().slice(0, 180);
    const player = updateGamePlayer(actor, { message, action: message ? 'Suhbatlashyapti' : 'Jim turibdi', pose: message ? 'talk' : 'idle', gesture: message ? 'explain' : '' });
    return res.json({ player: gamePublicPlayer(player), message: 'Xabar yuborildi' });
  }
  if (type === 'gesture') {
    const gesture = String(req.body.gesture || 'wave').slice(0, 24);
    const message = String(req.body.message || '').trim().slice(0, 180);
    const pose = ['wave','explain','handshake','sit','idle','talk'].includes(gesture) ? gesture : 'wave';
    const player = updateGamePlayer(actor, { gesture, pose, message: message || (gesture === 'wave' ? 'Salom!' : gesture === 'handshake' ? 'Tanishganimdan xursandman.' : ''), action: gesture === 'wave' ? 'Qo‘l ko‘tarib salom berdi' : gesture === 'handshake' ? 'Qo‘l uzatib ko‘rishmoqda' : gesture === 'explain' ? 'Qo‘li bilan tushuntiryapti' : 'Harakat bajaryapti' });
    return res.json({ player: gamePublicPlayer(player), message: 'Gesture yuborildi' });
  }
  if (type === 'sit') {
    const deskKey = String(req.body.desk || (actor.kind === 'client' ? 'waiting' : 'lounge'));
    const desk = GAME_DESKS[deskKey] || GAME_DESKS.waiting;
    const player = updateGamePlayer(actor, { x: desk.x, y: desk.y + 28, targetX: desk.x, targetY: desk.y + 28, room: desk.room, action: `${desk.label} yonida o‘tiribdi`, pose: 'sit', gesture: 'sit' });
    return res.json({ player: gamePublicPlayer(player), message: 'Joyga o‘tirdingiz' });
  }
  if (type === 'go-desk') {
    const deskKey = String(req.body.desk || 'reception');
    const desk = GAME_DESKS[deskKey] || GAME_DESKS.reception;
    const player = updateGamePlayer(actor, { x: desk.x - 26, y: desk.y + 34, targetX: desk.x - 26, targetY: desk.y + 34, room: desk.room, action: `${desk.label} tomon bordi`, pose: 'walk', gesture: '' });
    if (req.client) await Client.findByIdAndUpdate(req.client._id, { currentLocation: desk.room });
    return res.json({ player: gamePublicPlayer(player), message: `${desk.label}ga bordi` });
  }
  if (type === 'take-ticket') {
    if (!req.client) return res.status(403).json({ message: 'Navbatni mijoz sifatida oling' });
    const serviceType = String(req.body.serviceType || 'consulting');
    if (!SERVICE_TYPES[serviceType]) return res.status(400).json({ message: 'Xizmat turi noto‘g‘ri' });
    const active = await QueueTicket.findOne({ client: req.client._id, status: { $in: ['waiting', 'called', 'serving', 'redirected'] } });
    if (active) return res.status(409).json({ message: `Sizda faol navbat bor: ${active.ticketNo}` });
    const ticket = await createTicket({ client: req.client, serviceType, requestedOperation: SERVICE_TYPES[serviceType].label, question: req.body.question || randomItem(QUESTIONS[serviceType] || QUESTIONS.consulting), priority: req.client.segment === 'vip' ? 'vip' : req.client.segment === 'student' ? 'student' : 'normal', source: 'game-client', virtual: false });
    updateGamePlayer(actor, { x: GAME_DESKS.waiting.x, y: GAME_DESKS.waiting.y + 20, targetX: GAME_DESKS.waiting.x, targetY: GAME_DESKS.waiting.y + 20, room: 'waiting_hall', action: `${ticket.ticketNo} navbatini oldi`, message: SERVICE_TYPES[serviceType].label, pose: 'walk', gesture: 'ticket' });
    await audit(req, 'game_take_ticket', 'QueueTicket', ticket._id, { serviceType, client: req.client._id });
    return res.status(201).json({ ticket, message: `${ticket.ticketNo} navbat raqami olindi` });
  }
  if (type === 'call-next') {
    if (!req.user) return res.status(403).json({ message: 'Bu amal xodimlar uchun' });
    const serviceType = req.body.serviceType ? String(req.body.serviceType) : '';
    if (serviceType && (!SERVICE_TYPES[serviceType] || !canWorkService(req.user, serviceType))) return res.status(403).json({ message: 'Bu xizmat navbati sizga tegishli emas' });
    const services = serviceType ? [serviceType] : visibleServicesFor(req.user);
    if (!services.length) return res.status(403).json({ message: 'Sizga biriktirilgan xizmat yo‘q' });
    const ticket = await QueueTicket.findOne({ serviceType: { $in: services }, status: { $in: ['waiting','redirected'] } }).sort({ priority: -1, createdAt: 1 });
    if (!ticket) return res.status(404).json({ message: 'Kutayotgan mijoz yo‘q' });
    const desk = gameDeskForService(ticket.serviceType);
    ticket.status = 'called'; ticket.assignedTo = req.user._id; ticket.calledAt = new Date(); ticket.currentLocation = req.user.desk || desk.label;
    await ticket.save();
    if (ticket.client) await Client.findByIdAndUpdate(ticket.client, { currentLocation: ticket.currentLocation });
    updateGamePlayer(actor, { x: desk.x, y: desk.y, targetX: desk.x, targetY: desk.y, room: desk.room, action: `${ticket.ticketNo} mijozini chaqirdi`, message: ticket.question, pose: 'wave', gesture: 'wave' });
    await audit(req, 'game_queue_call', 'QueueTicket', ticket._id, { ticketNo: ticket.ticketNo });
    return res.json({ ticket: await ticket.populate([{ path: 'client', select: 'fullName phone mood currentLocation segment' }, { path: 'assignedTo', select: 'fullName role desk' }]), message: `${ticket.ticketNo} chaqirildi` });
  }
  if (type === 'accept-ticket') {
    if (!req.user) return res.status(403).json({ message: 'Bu amal xodimlar uchun' });
    const ticket = await QueueTicket.findById(req.body.ticketId);
    if (!ticket) return res.status(404).json({ message: 'Navbat topilmadi' });
    if (!canWorkService(req.user, ticket.serviceType) && !hasPermission(req.user, 'queue_manage')) return res.status(403).json({ message: 'Bu navbat sizga tegishli emas' });
    if (String(ticket.assignedTo || '') && String(ticket.assignedTo) !== String(req.user._id) && !hasPermission(req.user, 'queue_manage')) return res.status(403).json({ message: 'Bu mijoz boshqa xodimga biriktirilgan' });
    const desk = gameDeskForService(ticket.serviceType);
    ticket.status = 'serving'; ticket.assignedTo = req.user._id; ticket.startedAt = new Date(); ticket.currentLocation = desk.label;
    await ticket.save();
    if (ticket.client) await Client.findByIdAndUpdate(ticket.client, { currentLocation: desk.label });
    const player = updateGamePlayer(actor, { x: desk.x, y: desk.y, targetX: desk.x, targetY: desk.y, room: desk.room, action: `${ticket.ticketNo} mijozini qabul qilyapti`, message: ticket.question || `${ticket.ticketNo} bo‘yicha xizmat`, pose: 'talk', gesture: 'explain' });
    await audit(req, 'game_queue_accept', 'QueueTicket', ticket._id, { ticketNo: ticket.ticketNo });
    return res.json({ ticket: await ticket.populate([{ path: 'client', select: 'fullName phone mood currentLocation segment' }, { path: 'assignedTo', select: 'fullName role desk' }]), player: gamePublicPlayer(player), message: `${ticket.ticketNo} qabul qilindi` });
  }
  if (type === 'complete-ticket') {
    if (!req.user) return res.status(403).json({ message: 'Bu amal xodimlar uchun' });
    const ticket = await QueueTicket.findById(req.body.ticketId);
    if (!ticket) return res.status(404).json({ message: 'Navbat topilmadi' });
    if (!canWorkService(req.user, ticket.serviceType) && !hasPermission(req.user, 'queue_manage')) return res.status(403).json({ message: 'Bu navbat sizga tegishli emas' });
    ticket.status = 'completed'; ticket.completedAt = new Date(); ticket.notes = String(req.body.notes || 'Virtual filialda xizmat yakunlandi'); ticket.currentLocation = 'exit';
    await ticket.save();
    if (ticket.client) await Client.findByIdAndUpdate(ticket.client, { currentLocation: 'exit' });
    await audit(req, 'game_queue_complete', 'QueueTicket', ticket._id, { ticketNo: ticket.ticketNo });
    return res.json({ ticket, message: `${ticket.ticketNo} yakunlandi` });
  }
  return res.status(400).json({ message: 'Game action noma’lum' });
}));

app.get('/api/transactions', auth(), permit('view_reports', 'audit_view'), asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.kind) filter.kind = req.query.kind;
  if (req.query.client) filter.client = req.query.client;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }
  res.json(await Transaction.find(filter).populate('performedBy', 'fullName role').populate('client', 'fullName phone').populate('debitAccount', 'accountNumber currency').populate('creditAccount', 'accountNumber currency').sort({ createdAt: -1 }).limit(Number(req.query.limit || 500)));
}));
app.get('/api/audit', auth(), permit('audit_view'), asyncHandler(async (req, res) => res.json(await AuditLog.find().populate('actor', 'fullName role').sort({ createdAt: -1 }).limit(300))));
app.get('/api/reports/monthly', auth(), permit('view_reports'), asyncHandler(async (req, res) => {
  const state = await getBankState();
  const year = Number(req.query.year || new Date().getFullYear());
  const start = new Date(`${year}-01-01T00:00:00.000Z`);
  const end = new Date(`${year + 1}-01-01T00:00:00.000Z`);
  const [monthly, loansByStatus, accountsByCurrency, queueByService] = await Promise.all([
    Transaction.aggregate([{ $match: { createdAt: { $gte: start, $lt: end }, status: 'success' } }, { $group: { _id: { month: { $month: '$createdAt' }, kind: '$kind' }, totalUZS: { $sum: '$amountUZS' }, count: { $sum: 1 } } }, { $sort: { '_id.month': 1 } }]),
    Loan.aggregate([{ $group: { _id: '$status', outstanding: { $sum: '$outstanding' }, count: { $sum: 1 } } }]),
    Account.aggregate([{ $group: { _id: '$currency', balance: { $sum: '$balance' }, count: { $sum: 1 } } }]),
    QueueTicket.aggregate([{ $match: { createdAt: { $gte: start, $lt: end } } }, { $group: { _id: '$serviceType', count: { $sum: 1 } } }]),
  ]);
  res.json({ year, rates: state.rates, monthly, loansByStatus, accountsByCurrency, queueByService });
}));

app.use((err, req, res, next) => {
  console.error('API ERROR:', err);
  if (err.code === 11000) return res.status(409).json({ message: 'Bunday ma’lumot allaqachon mavjud', details: err.keyValue });
  res.status(err.statusCode || 500).json({ message: err.message || 'Server xatosi' });
});

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB ulandi');
    await ensureInitialData();
    app.listen(PORT, () => console.log(`🚀 Server ishga tushdi: http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB ulanish xatosi:', err.message);
    process.exit(1);
  });
