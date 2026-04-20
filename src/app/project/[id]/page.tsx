"use client";

import { useState, useCallback, useRef, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SIGNATURE } from "@/lib/default-signature";

// ── Types ──────────────────────────────────────────────────────────
interface Recipient {
  id: string;
  email: string;
  name: string;
  company: string;
  bcc: string;
  customFields: Record<string, string>;
}

interface Attachment {
  filename: string;
  content: string;
  size: number;
}

interface SendResult {
  email: string;
  success: boolean;
  error?: string;
}

interface HistoryEntry {
  id: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  success: boolean;
  errorMessage: string | null;
  sentAt: string;
}

interface ProjectData {
  id: string;
  name: string;
  senderName: string;
  globalBcc: string;
  subject: string;
  body: string;
  signature: string;
  customFieldNames: string[];
}

// ── Helpers ────────────────────────────────────────────────────────
function interpolatePreview(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    return variables[key] !== undefined ? variables[key] : match;
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Tabs ───────────────────────────────────────────────────────────
const TABS = ["수신자", "이메일 작성", "미리보기 & 테스트", "발송", "히스토리"];

// ── Main Component ─────────────────────────────────────────────────
export default function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Project data
  const [project, setProject] = useState<ProjectData | null>(null);
  const [senderName, setSenderName] = useState("");
  const [globalBcc, setGlobalBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [signature, setSignature] = useState(DEFAULT_SIGNATURE);
  const [showSignatureEditor, setShowSignatureEditor] = useState(false);
  const [customFieldNames, setCustomFieldNames] = useState<string[]>([]);

  // Recipients
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [bulkInput, setBulkInput] = useState("");

  // Google Sheets import
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetData, setSheetData] = useState<{
    headers: string[];
    data: string[][];
  } | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, number | null>>({
    name: null,
    email: null,
    company: null,
    bcc: null,
  });

  // Email
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [lastFocused, setLastFocused] = useState<"subject" | "body">("body");

  // Send
  const [previewIndex, setPreviewIndex] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);
  const [sendSummary, setSendSummary] = useState<{
    total: number;
    sent: number;
    failed: number;
  } | null>(null);

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Load project data ──────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const [projRes, recipRes] = await Promise.all([
        fetch(`/api/projects/${projectId}`),
        fetch(`/api/projects/${projectId}/recipients`),
      ]);
      const proj = await projRes.json();
      const recips = await recipRes.json();

      if (proj.error) {
        router.push("/");
        return;
      }

      setProject(proj);
      setSenderName(proj.senderName || "");
      setGlobalBcc(proj.globalBcc || "");
      setSubject(proj.subject || "");
      setBody(proj.body || "");
      setSignature(proj.signature || DEFAULT_SIGNATURE);
      setCustomFieldNames(proj.customFieldNames || []);
      setRecipients(
        recips.map(
          (r: {
            id: string;
            email: string;
            name: string;
            company: string;
            bcc: string;
            customFields: Record<string, string>;
          }) => ({
            id: r.id,
            email: r.email,
            name: r.name || "",
            company: r.company || "",
            bcc: r.bcc || "",
            customFields: r.customFields || {},
          })
        )
      );
      setLoading(false);
    }
    load();
  }, [projectId, router]);

  // ── Auto-save project settings ─────────────────────────────────
  const saveProject = useCallback(
    async (fields: Partial<ProjectData>) => {
      setSaving(true);
      await fetch(`/api/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      setSaving(false);
    },
    [projectId]
  );

  // Debounced save for subject/body
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = useCallback(
    (fields: Partial<ProjectData>) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => saveProject(fields), 800);
    },
    [saveProject]
  );

  // ── Save recipients to DB ─────────────────────────────────────
  const saveRecipientsToDb = useCallback(
    async (newRecipients: Recipient[]) => {
      // Delete all then re-insert (simple approach)
      await fetch(`/api/projects/${projectId}/recipients`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (newRecipients.length > 0) {
        const res = await fetch(`/api/projects/${projectId}/recipients`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipients: newRecipients }),
        });
        const saved = await res.json();
        // Update with DB-generated IDs
        if (Array.isArray(saved)) {
          setRecipients(
            saved.map(
              (r: {
                id: string;
                email: string;
                name: string;
                company: string;
                bcc: string;
                customFields: Record<string, string>;
              }) => ({
                id: r.id,
                email: r.email,
                name: r.name || "",
                company: r.company || "",
                bcc: r.bcc || "",
                customFields: r.customFields || {},
              })
            )
          );
        }
      }
    },
    [projectId]
  );

  // ── Recipient management ───────────────────────────────────────
  const addRecipient = useCallback(() => {
    const newR: Recipient = {
      id: crypto.randomUUID(),
      email: "",
      name: "",
      company: "",
      bcc: "",
      customFields: Object.fromEntries(customFieldNames.map((f) => [f, ""])),
    };
    setRecipients((prev) => [...prev, newR]);
  }, [customFieldNames]);

  const updateRecipient = useCallback(
    (id: string, field: string, value: string) => {
      setRecipients((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          if (["email", "name", "company", "bcc"].includes(field)) {
            return { ...r, [field]: value };
          }
          return {
            ...r,
            customFields: { ...r.customFields, [field]: value },
          };
        })
      );
    },
    []
  );

  const removeRecipient = useCallback((id: string) => {
    setRecipients((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addCustomField = useCallback(() => {
    const name = prompt("추가할 필드 이름 (영문):");
    if (!name || customFieldNames.includes(name)) return;
    const updated = [...customFieldNames, name];
    setCustomFieldNames(updated);
    setRecipients((prev) =>
      prev.map((r) => ({
        ...r,
        customFields: { ...r.customFields, [name]: "" },
      }))
    );
    saveProject({ customFieldNames: updated });
  }, [customFieldNames, saveProject]);

  const removeCustomField = useCallback(
    (fieldName: string) => {
      const updated = customFieldNames.filter((f) => f !== fieldName);
      setCustomFieldNames(updated);
      setRecipients((prev) =>
        prev.map((r) => {
          const newFields = { ...r.customFields };
          delete newFields[fieldName];
          return { ...r, customFields: newFields };
        })
      );
      saveProject({ customFieldNames: updated });
    },
    [customFieldNames, saveProject]
  );

  // Save recipients when leaving recipients tab
  const handleTabChange = useCallback(
    (newTab: number) => {
      if (tab === 0 && newTab !== 0) {
        saveRecipientsToDb(recipients);
      }
      if (newTab === 4) {
        // Load history
        setHistoryLoading(true);
        fetch(`/api/projects/${projectId}/history`)
          .then((r) => r.json())
          .then((data) => {
            setHistory(data);
            setHistoryLoading(false);
          });
      }
      setTab(newTab);
    },
    [tab, recipients, saveRecipientsToDb, projectId]
  );

  // Bulk input parsing — auto-detects headers and creates custom fields
  const parseBulkInput = useCallback(() => {
    if (!bulkInput.trim()) return;
    const lines = bulkInput.trim().split("\n");
    if (lines.length === 0) return;

    // Parse all lines into arrays
    const allParts = lines.map((line) =>
      line.split(/\t/).map((p) => p.trim())
    );

    // Check if first row is a header (contains email-related keyword, no @ in any cell)
    const emailKeywords = ["이메일", "email", "e-mail", "mail"];
    const nameKeywords = ["이름", "성명", "name", "담당자"];
    const firstRow = allParts[0];
    const isHeader =
      firstRow.some((c) =>
        emailKeywords.some((k) => c.toLowerCase().includes(k))
      ) && !firstRow.some((c) => c.includes("@"));

    let headers: string[] | null = null;
    let dataRows = allParts;

    if (isHeader) {
      headers = firstRow;
      dataRows = allParts.slice(1);
    }

    // Auto-detect column indices for name and email
    let nameIdx = -1;
    let emailIdx = -1;

    if (headers) {
      // Use header keywords to find name/email columns
      headers.forEach((h, i) => {
        const lower = h.toLowerCase();
        if (emailIdx === -1 && emailKeywords.some((k) => lower.includes(k)))
          emailIdx = i;
        if (nameIdx === -1 && nameKeywords.some((k) => lower.includes(k)))
          nameIdx = i;
      });
    }

    // Fallback: auto-detect by content
    if (emailIdx === -1 && dataRows.length > 0) {
      const firstData = dataRows[0];
      for (let i = 0; i < firstData.length; i++) {
        if (firstData[i].includes("@")) {
          emailIdx = i;
          break;
        }
      }
    }
    if (nameIdx === -1) {
      // Name is typically the column before email, or column 0
      nameIdx = emailIdx > 0 ? 0 : -1;
    }

    // All other columns become custom fields
    const extraFieldDefs: { index: number; name: string }[] = [];
    if (headers) {
      headers.forEach((h, i) => {
        if (i !== nameIdx && i !== emailIdx && h) {
          extraFieldDefs.push({ index: i, name: h });
        }
      });
    } else if (dataRows[0]) {
      // No headers — name columns as 열1, 열2...
      dataRows[0].forEach((_, i) => {
        if (i !== nameIdx && i !== emailIdx) {
          extraFieldDefs.push({ index: i, name: `열${i + 1}` });
        }
      });
    }

    // Register new custom fields
    const newFieldNames = extraFieldDefs
      .map((f) => f.name)
      .filter((n) => !customFieldNames.includes(n));
    const allCustomFields = [...customFieldNames, ...newFieldNames];
    if (newFieldNames.length > 0) {
      setCustomFieldNames(allCustomFields);
      saveProject({ customFieldNames: allCustomFields });
    }

    // Parse data rows
    const newRecipients: Recipient[] = [];
    for (const parts of dataRows) {
      const email = emailIdx >= 0 ? (parts[emailIdx] || "").trim() : "";
      if (!email || !email.includes("@")) continue;

      const name = nameIdx >= 0 ? (parts[nameIdx] || "").trim() : "";

      const customFields: Record<string, string> = {};
      for (const cf of allCustomFields) {
        const def = extraFieldDefs.find((f) => f.name === cf);
        customFields[cf] = def ? (parts[def.index] || "").trim() : "";
      }

      newRecipients.push({
        id: crypto.randomUUID(),
        email,
        name,
        company: "",
        bcc: "",
        customFields,
      });
    }

    setRecipients((prev) => [...prev, ...newRecipients]);
    setBulkInput("");
  }, [bulkInput, customFieldNames, saveProject]);

  // ── Google Sheets import ───────────────────────────────────────
  const fetchSheet = useCallback(async () => {
    if (!sheetUrl.trim()) return;
    setSheetLoading(true);
    setSheetData(null);

    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      const result = await res.json();
      if (result.error) {
        alert(result.error);
        return;
      }
      setSheetData({ headers: result.headers, data: result.data });

      const autoMap: Record<string, number | null> = {
        name: null,
        email: null,
        company: null,
        bcc: null,
      };
      const emailKw = ["email", "e-mail", "이메일", "mail"];
      const nameKw = ["name", "이름", "성명", "담당자"];
      const companyKw = ["company", "회사", "기업", "소속", "organization"];
      const bccKw = ["bcc"];

      result.headers.forEach((h: string, i: number) => {
        const lower = h.toLowerCase().trim();
        if (emailKw.some((k) => lower.includes(k))) autoMap.email = i;
        if (nameKw.some((k) => lower.includes(k))) autoMap.name = i;
        if (companyKw.some((k) => lower.includes(k))) autoMap.company = i;
        if (bccKw.some((k) => lower.includes(k))) autoMap.bcc = i;
      });
      setColumnMap(autoMap);
    } catch {
      alert("시트를 가져오는 중 에러가 발생했습니다.");
    } finally {
      setSheetLoading(false);
    }
  }, [sheetUrl]);

  const applySheetData = useCallback(() => {
    if (!sheetData) return;

    const mappedIndices = new Set(
      Object.values(columnMap).filter((v): v is number => v !== null)
    );

    const extraFields: { index: number; name: string }[] = [];
    sheetData.headers.forEach((h, i) => {
      if (!mappedIndices.has(i) && h.trim()) {
        extraFields.push({ index: i, name: h.trim() });
      }
    });

    const newFieldNames = extraFields
      .map((f) => f.name)
      .filter((n) => !customFieldNames.includes(n));
    const allCustomFields = [...customFieldNames, ...newFieldNames];

    if (newFieldNames.length > 0) {
      setCustomFieldNames(allCustomFields);
      saveProject({ customFieldNames: allCustomFields });
    }

    const newRecipients: Recipient[] = [];
    for (const row of sheetData.data) {
      const email =
        columnMap.email !== null ? (row[columnMap.email] || "").trim() : "";
      if (!email) continue;

      const name =
        columnMap.name !== null ? (row[columnMap.name] || "").trim() : "";
      const company =
        columnMap.company !== null
          ? (row[columnMap.company] || "").trim()
          : "";
      const bcc =
        columnMap.bcc !== null ? (row[columnMap.bcc] || "").trim() : "";

      const customFields: Record<string, string> = {};
      for (const cf of allCustomFields) {
        const extra = extraFields.find((f) => f.name === cf);
        customFields[cf] = extra ? (row[extra.index] || "").trim() : "";
      }

      newRecipients.push({
        id: crypto.randomUUID(),
        email,
        name,
        company,
        bcc,
        customFields,
      });
    }

    setRecipients((prev) => [...prev, ...newRecipients]);
    setSheetData(null);
    setSheetUrl("");
  }, [sheetData, columnMap, customFieldNames, saveProject]);

  // ── File handling ──────────────────────────────────────────────
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        const content = await fileToBase64(file);
        setAttachments((prev) => [
          ...prev,
          { filename: file.name, content, size: file.size },
        ]);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    []
  );

  // ── Sending ────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (isTest: boolean) => {
      setSending(true);
      setSendResults(null);
      setSendSummary(null);

      try {
        const res = await fetch(`/api/projects/${projectId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipients,
            subject,
            body: body.replace(/\n/g, "<br>") + (signature ? "<br><br>" + signature : ""),
            senderName,
            globalBcc,
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              encoding: "base64",
            })),
            isTest,
            testEmail: "sun@2080.ventures",
            testBcc: "sungahn.choi0303@gmail.com",
          }),
        });

        const result = await res.json();
        if (result.error) {
          alert(`에러: ${result.error}`);
        } else {
          setSendResults(result.results);
          setSendSummary(result.summary);
        }
      } catch (err) {
        alert(`발송 실패: ${err instanceof Error ? err.message : "Unknown"}`);
      } finally {
        setSending(false);
      }
    },
    [recipients, subject, body, signature, senderName, globalBcc, attachments, projectId]
  );

  // ── Preview helpers ────────────────────────────────────────────
  const getPreviewVariables = (
    recipient: Recipient
  ): Record<string, string> => ({
    name: recipient.name,
    email: recipient.email,
    company: recipient.company,
    ...recipient.customFields,
  });

  const availablePlaceholders = [
    "name",
    "email",
    "company",
    ...customFieldNames,
  ];

  const insertPlaceholder = useCallback(
    (p: string) => {
      const tag = `{${p}}`;
      if (lastFocused === "subject" && subjectInputRef.current) {
        const el = subjectInputRef.current;
        const start = el.selectionStart ?? subject.length;
        const end = el.selectionEnd ?? subject.length;
        const newVal = subject.slice(0, start) + tag + subject.slice(end);
        setSubject(newVal);
        debouncedSave({ subject: newVal });
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(start + tag.length, start + tag.length);
        });
      } else if (bodyTextareaRef.current) {
        const el = bodyTextareaRef.current;
        const start = el.selectionStart ?? body.length;
        const end = el.selectionEnd ?? body.length;
        const newVal = body.slice(0, start) + tag + body.slice(end);
        setBody(newVal);
        debouncedSave({ body: newVal });
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(start + tag.length, start + tag.length);
        });
      }
    },
    [lastFocused, subject, body, debouncedSave]
  );

  // ── Render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (tab === 0) saveRecipientsToDb(recipients);
                router.push("/");
              }}
              className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-gray-900">{project.name}</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-gray-500">{recipients.length}명 수신자</span>
                {saving && (
                  <span className="text-xs text-blue-500 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                    저장 중
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="bg-white/60 backdrop-blur-sm border-b border-gray-200/60 px-6">
        <div className="max-w-6xl mx-auto flex">
          {TABS.map((label, i) => (
            <button
              key={label}
              onClick={() => handleTabChange(i)}
              className={`flex-1 text-center py-3.5 text-sm font-medium border-b-2 ${
                i === tab
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* ── TAB 0: Recipients ───────────────────────────────── */}
        {tab === 0 && (
          <div className="space-y-6">
            {/* Project settings inline */}
            <div className="bg-white border border-gray-200/60 rounded-2xl p-5 shadow-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    발신자 이름
                  </label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => {
                      setSenderName(e.target.value);
                      debouncedSave({ senderName: e.target.value });
                    }}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    글로벌 BCC
                  </label>
                  <input
                    type="text"
                    value={globalBcc}
                    onChange={(e) => {
                      setGlobalBcc(e.target.value);
                      debouncedSave({ globalBcc: e.target.value });
                    }}
                    placeholder="선택사항"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                수신자 목록 ({recipients.length}명)
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={addCustomField}
                  className="text-sm px-3.5 py-1.5 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
                >
                  + 커스텀 필드
                </button>
                <button
                  onClick={addRecipient}
                  className="text-sm px-3.5 py-1.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 active:scale-[0.98]"
                >
                  + 수신자 추가
                </button>
              </div>
            </div>

            {/* Google Sheets import */}
            <div className="bg-white border border-gray-200/60 rounded-2xl p-5 shadow-sm">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Google Sheets에서 가져오기
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="Google Sheets URL 붙여넣기"
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <button
                  onClick={fetchSheet}
                  disabled={!sheetUrl.trim() || sheetLoading}
                  className="text-sm px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-40 active:scale-[0.98] shadow-sm shadow-emerald-200 whitespace-nowrap"
                >
                  {sheetLoading ? "로딩 중..." : "가져오기"}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                시트가 &quot;링크가 있는 모든 사용자에게 공개&quot; 상태여야
                합니다.
              </p>

              {sheetData && (
                <div className="mt-4 space-y-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm font-medium text-gray-700 mb-3">
                      컬럼 매핑
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {(
                        [
                          { key: "email", label: "이메일 *" },
                          { key: "name", label: "이름" },
                          { key: "company", label: "회사" },
                          { key: "bcc", label: "BCC" },
                        ] as const
                      ).map(({ key, label }) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-sm text-gray-600 w-20">
                            {label}
                          </span>
                          <select
                            value={
                              columnMap[key] !== null
                                ? String(columnMap[key])
                                : ""
                            }
                            onChange={(e) =>
                              setColumnMap((prev) => ({
                                ...prev,
                                [key]: e.target.value
                                  ? Number(e.target.value)
                                  : null,
                              }))
                            }
                            className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm outline-none"
                          >
                            <option value="">-- 선택 안 함 --</option>
                            {sheetData.headers.map((h, i) => (
                              <option key={i} value={String(i)}>
                                {h || `(열 ${i + 1})`}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      매핑 안 된 컬럼은 커스텀 필드로 자동 추가됩니다.
                    </p>
                  </div>

                  <div className="overflow-x-auto max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0">
                        <tr className="bg-gray-100 border-b border-gray-200">
                          <th className="px-2 py-1.5 text-left text-gray-500">
                            #
                          </th>
                          {sheetData.headers.map((h, i) => {
                            const mappedTo = Object.entries(columnMap).find(
                              ([, v]) => v === i
                            );
                            return (
                              <th
                                key={i}
                                className={`px-2 py-1.5 text-left font-medium ${
                                  mappedTo
                                    ? "text-blue-700 bg-blue-50"
                                    : "text-gray-600"
                                }`}
                              >
                                {h || `(열 ${i + 1})`}
                                {mappedTo && (
                                  <span className="ml-1 text-blue-500 font-normal">
                                    → {mappedTo[0]}
                                  </span>
                                )}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {sheetData.data.slice(0, 10).map((row, ri) => (
                          <tr
                            key={ri}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="px-2 py-1 text-gray-400">
                              {ri + 1}
                            </td>
                            {sheetData.headers.map((_, ci) => (
                              <td
                                key={ci}
                                className="px-2 py-1 text-gray-700 max-w-48 truncate"
                              >
                                {row[ci] || ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {sheetData.data.length > 10 && (
                      <div className="px-3 py-2 bg-gray-50 text-xs text-gray-500 text-center">
                        ... 외 {sheetData.data.length - 10}행 (총{" "}
                        {sheetData.data.length}행)
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={applySheetData}
                      disabled={columnMap.email === null}
                      className="text-sm px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-40 active:scale-[0.98] shadow-sm shadow-emerald-200"
                    >
                      {sheetData.data.length}명 추가
                    </button>
                    <button
                      onClick={() => {
                        setSheetData(null);
                        setSheetUrl("");
                      }}
                      className="text-sm px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
                    >
                      취소
                    </button>
                    {columnMap.email === null && (
                      <span className="text-xs text-red-500 self-center">
                        이메일 컬럼을 매핑하세요
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Bulk input */}
            <div className="bg-white border border-gray-200/60 rounded-2xl p-5 shadow-sm">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                일괄 입력 (탭 또는 쉼표 구분)
              </label>
              <textarea
                value={bulkInput}
                onChange={(e) => setBulkInput(e.target.value)}
                placeholder={`이름, 이메일, 회사\nJohn Kim, john@company.com, ABC Corp`}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
              <button
                onClick={parseBulkInput}
                disabled={!bulkInput.trim()}
                className="mt-2 text-sm px-4 py-2 bg-gray-800 text-white rounded-xl font-medium hover:bg-gray-900 disabled:opacity-40 active:scale-[0.98]"
              >
                파싱하여 추가
              </button>
            </div>

            {/* Recipients table */}
            {recipients.length > 0 && (
              <div className="bg-white border border-gray-200/60 rounded-2xl overflow-x-auto shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-3 py-2 font-medium text-gray-600">
                        #
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">
                        <div>이름</div>
                        <code className="text-xs font-normal text-blue-500">
                          {"{name}"}
                        </code>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">
                        <div>이메일 *</div>
                        <code className="text-xs font-normal text-blue-500">
                          {"{email}"}
                        </code>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">
                        <div>회사</div>
                        <code className="text-xs font-normal text-blue-500">
                          {"{company}"}
                        </code>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-gray-600">
                        BCC
                      </th>
                      {customFieldNames.map((f) => (
                        <th
                          key={f}
                          className="text-left px-3 py-2 font-medium text-gray-600"
                        >
                          <div className="flex items-center gap-1">
                            {f}
                            <button
                              onClick={() => removeCustomField(f)}
                              className="text-red-400 hover:text-red-600"
                            >
                              ×
                            </button>
                          </div>
                          <code className="text-xs font-normal text-blue-500">{`{${f}}`}</code>
                        </th>
                      ))}
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((r, i) => (
                      <tr
                        key={r.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={r.name}
                            onChange={(e) =>
                              updateRecipient(r.id, "name", e.target.value)
                            }
                            className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="email"
                            value={r.email}
                            onChange={(e) =>
                              updateRecipient(r.id, "email", e.target.value)
                            }
                            className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={r.company}
                            onChange={(e) =>
                              updateRecipient(r.id, "company", e.target.value)
                            }
                            className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="email"
                            value={r.bcc}
                            onChange={(e) =>
                              updateRecipient(r.id, "bcc", e.target.value)
                            }
                            className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                          />
                        </td>
                        {customFieldNames.map((f) => (
                          <td key={f} className="px-3 py-1.5">
                            <input
                              type="text"
                              value={r.customFields[f] || ""}
                              onChange={(e) =>
                                updateRecipient(r.id, f, e.target.value)
                              }
                              className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 outline-none"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-1.5">
                          <button
                            onClick={() => removeRecipient(r.id)}
                            className="text-red-400 hover:text-red-600 text-lg"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Variable summary */}
            {recipients.length > 0 && (
              <div className="bg-blue-50/80 border border-blue-200/60 rounded-2xl p-5">
                <p className="text-sm font-medium text-blue-800 mb-2">
                  이메일 작성에서 사용 가능한 변수
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {availablePlaceholders.map((p) => (
                    <code
                      key={p}
                      className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-sm"
                    >
                      {`{${p}}`}
                    </code>
                  ))}
                </div>
                {recipients[0] && (
                  <div className="text-xs text-blue-700">
                    <span className="font-medium">
                      예시 (첫 번째 수신자):{" "}
                    </span>
                    {availablePlaceholders.map((p) => {
                      const val =
                        p === "name"
                          ? recipients[0].name
                          : p === "email"
                          ? recipients[0].email
                          : p === "company"
                          ? recipients[0].company
                          : recipients[0].customFields[p] || "";
                      return val ? (
                        <span key={p} className="mr-3">
                          {`{${p}}`} ={" "}
                          <span className="font-medium">{val}</span>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={() => {
                saveRecipientsToDb(recipients);
                handleTabChange(1);
              }}
              disabled={
                recipients.length === 0 ||
                recipients.some((r) => !r.email.trim())
              }
              className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] shadow-sm shadow-blue-200"
            >
              이메일 작성으로 →
            </button>
          </div>
        )}

        {/* ── TAB 1: Email Compose ────────────────────────────── */}
        {tab === 1 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">이메일 작성</h2>

            <div className="bg-blue-50/80 border border-blue-200/60 rounded-2xl p-5">
              <p className="text-sm font-medium text-blue-800 mb-2">
                클릭하면 커서 위치에 변수 삽입
              </p>
              <div className="flex flex-wrap gap-2">
                {availablePlaceholders.map((p) => {
                  const sampleVal = recipients[0]
                    ? p === "name"
                      ? recipients[0].name
                      : p === "email"
                      ? recipients[0].email
                      : p === "company"
                      ? recipients[0].company
                      : recipients[0].customFields[p] || ""
                    : "";
                  return (
                    <button
                      key={p}
                      className="bg-blue-100 text-blue-700 px-2.5 py-1 rounded text-sm cursor-pointer hover:bg-blue-200 transition-colors text-left"
                      onClick={() => insertPlaceholder(p)}
                    >
                      <code className="font-mono">{`{${p}}`}</code>
                      {sampleVal && (
                        <span className="text-blue-500 text-xs ml-1.5">
                          ={" "}
                          {sampleVal.length > 20
                            ? sampleVal.slice(0, 20) + "..."
                            : sampleVal}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                제목 (Subject)
              </label>
              <input
                ref={subjectInputRef}
                type="text"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  debouncedSave({ subject: e.target.value });
                }}
                onFocus={() => setLastFocused("subject")}
                placeholder="예: {company} - Partnership Proposal from 2080 Ventures"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                본문 (HTML 지원)
              </label>
              <textarea
                ref={bodyTextareaRef}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  debouncedSave({ body: e.target.value });
                }}
                onFocus={() => setLastFocused("body")}
                placeholder={`Dear {name},\n\nI am reaching out from 2080 Ventures regarding a potential partnership with {company}.\n\n...\n\nBest regards,\nSun Choi`}
                rows={16}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono leading-relaxed bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                HTML 태그 사용 가능. 줄바꿈은 자동으로 &lt;br&gt;로 변환됩니다.
                링크: &lt;a href=&quot;URL&quot;&gt;텍스트&lt;/a&gt;
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                첨부파일
              </label>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sm px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
                >
                  파일 선택
                </button>
                <span className="text-xs text-gray-500">
                  {attachments.length}개 첨부됨
                </span>
              </div>
              {attachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {attachments.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded px-3 py-1.5"
                    >
                      <span>{a.filename}</span>
                      <span className="text-gray-400 text-xs">
                        ({formatFileSize(a.size)})
                      </span>
                      <button
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((_, idx) => idx !== i)
                          )
                        }
                        className="ml-auto text-red-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Signature */}
            <div className="bg-white border border-gray-200/60 rounded-2xl shadow-sm overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200/60 cursor-pointer"
                onClick={() => setShowSignatureEditor(!showSignatureEditor)}
              >
                <span className="text-sm font-semibold text-gray-700">
                  서명 {signature ? "✓" : ""}
                </span>
                <span className="text-xs text-gray-500">
                  {showSignatureEditor ? "접기 ▲" : "편집 ▼"}
                </span>
              </div>
              {!showSignatureEditor && signature && (
                <div
                  className="px-5 py-3 text-xs text-gray-500 max-h-24 overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: signature }}
                />
              )}
              {showSignatureEditor && (
                <div className="p-5 space-y-3">
                  <textarea
                    value={signature}
                    onChange={(e) => {
                      setSignature(e.target.value);
                      debouncedSave({ signature: e.target.value });
                    }}
                    rows={12}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-xs font-mono leading-relaxed bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="HTML 서명을 입력하세요"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setSignature(DEFAULT_SIGNATURE);
                        debouncedSave({ signature: DEFAULT_SIGNATURE });
                      }}
                      className="text-xs px-3 py-1.5 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
                    >
                      기본 서명 복원
                    </button>
                    <button
                      onClick={() => {
                        setSignature("");
                        debouncedSave({ signature: "" });
                      }}
                      className="text-xs px-3 py-1.5 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium text-red-500"
                    >
                      서명 제거
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleTabChange(0)}
                className="px-6 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
              >
                ← 수신자
              </button>
              <button
                onClick={() => handleTabChange(2)}
                disabled={!subject.trim() || !body.trim()}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] shadow-sm shadow-blue-200"
              >
                미리보기 →
              </button>
            </div>
          </div>
        )}

        {/* ── TAB 2: Preview & Test ───────────────────────────── */}
        {tab === 2 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">
              미리보기 & 테스트 발송
            </h2>

            {recipients.length > 0 && (
              <>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-600">수신자 선택:</label>
                  <select
                    value={previewIndex}
                    onChange={(e) => setPreviewIndex(Number(e.target.value))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm outline-none"
                  >
                    {recipients.map((r, i) => (
                      <option key={r.id} value={i}>
                        {r.name || r.email} ({r.company || "N/A"})
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-400">
                    {previewIndex + 1} / {recipients.length}
                  </span>
                </div>

                <div className="bg-white border border-gray-200/60 rounded-2xl overflow-hidden shadow-sm">
                  <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
                    <div className="text-sm">
                      <span className="text-gray-500">From: </span>
                      <span className="font-medium">
                        {senderName} &lt;sun@2080.ventures&gt;
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-gray-500">To: </span>
                      <span>{recipients[previewIndex]?.email}</span>
                    </div>
                    {(globalBcc || recipients[previewIndex]?.bcc) && (
                      <div className="text-sm">
                        <span className="text-gray-500">BCC: </span>
                        <span>
                          {[globalBcc, recipients[previewIndex]?.bcc]
                            .filter(Boolean)
                            .join(", ")}
                        </span>
                      </div>
                    )}
                    <div className="text-sm mt-1">
                      <span className="text-gray-500">Subject: </span>
                      <span className="font-medium">
                        {interpolatePreview(
                          subject,
                          getPreviewVariables(recipients[previewIndex])
                        )}
                      </span>
                    </div>
                  </div>
                  <div
                    className="px-6 py-4 text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: interpolatePreview(
                        body.replace(/\n/g, "<br>") + (signature ? "<br><br>" + signature : ""),
                        getPreviewVariables(recipients[previewIndex])
                      ),
                    }}
                  />
                  {attachments.length > 0 && (
                    <div className="border-t border-gray-200 px-4 py-2 bg-gray-50">
                      <span className="text-xs text-gray-500">첨부: </span>
                      {attachments.map((a, i) => (
                        <span key={i} className="text-xs text-gray-600">
                          {a.filename}
                          {i < attachments.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="bg-amber-50/80 border border-amber-200/60 rounded-2xl p-5">
              <h3 className="text-sm font-medium text-yellow-800 mb-2">
                테스트 발송
              </h3>
              <p className="text-xs text-yellow-700 mb-3">
                첫 번째 수신자의 변수로 테스트 발송
                <br />
                To: sun@2080.ventures | BCC: sungahn.choi0303@gmail.com
              </p>
              <button
                onClick={() => handleSend(true)}
                disabled={sending}
                className="bg-amber-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 active:scale-[0.98] shadow-sm shadow-amber-200"
              >
                {sending ? "발송 중..." : "테스트 발송"}
              </button>
              {sendResults && sendResults.length > 0 && tab === 2 && (
                <div className="mt-3">
                  {sendResults[0].success ? (
                    <p className="text-sm text-green-700 font-medium">
                      테스트 발송 완료!
                    </p>
                  ) : (
                    <p className="text-sm text-red-700 font-medium">
                      실패: {sendResults[0].error}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => handleTabChange(1)}
                className="px-6 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 border border-gray-200"
              >
                ← 이메일 작성
              </button>
              <button
                onClick={() => {
                  setSendResults(null);
                  setSendSummary(null);
                  handleTabChange(3);
                }}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                실제 발송으로 →
              </button>
            </div>
          </div>
        )}

        {/* ── TAB 3: Real Send ────────────────────────────────── */}
        {tab === 3 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-gray-900">실제 발송</h2>

            <div className="bg-white border border-gray-200/60 rounded-2xl p-6 shadow-sm">
              <h3 className="text-sm font-medium text-gray-700 mb-4">
                발송 요약
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">프로젝트:</span>
                  <span className="ml-2 font-medium">{project.name}</span>
                </div>
                <div>
                  <span className="text-gray-500">발신자:</span>
                  <span className="ml-2 font-medium">{senderName}</span>
                </div>
                <div>
                  <span className="text-gray-500">수신자:</span>
                  <span className="ml-2 font-medium">
                    {recipients.length}명
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">첨부파일:</span>
                  <span className="ml-2 font-medium">
                    {attachments.length}개
                  </span>
                </div>
              </div>
              <div className="mt-4 border-t border-gray-100 pt-4 space-y-1 max-h-40 overflow-y-auto">
                {recipients.map((r, i) => (
                  <div key={r.id} className="text-xs text-gray-600">
                    {i + 1}. {r.name} &lt;{r.email}&gt;{" "}
                    {r.company && `(${r.company})`}
                  </div>
                ))}
              </div>
            </div>

            {!sendSummary && (
              <div className="bg-red-50/80 border border-red-200/60 rounded-2xl p-5">
                <p className="text-sm text-red-800 font-medium mb-3">
                  {recipients.length}명에게 발송합니다. 취소할 수 없습니다.
                </p>
                <button
                  onClick={() => handleSend(false)}
                  disabled={sending}
                  className="bg-red-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50 active:scale-[0.98] shadow-sm shadow-red-200"
                >
                  {sending
                    ? `발송 중...`
                    : `${recipients.length}명에게 발송하기`}
                </button>
              </div>
            )}

            {sendSummary && (
              <div className="bg-white border border-gray-200/60 rounded-2xl p-6 shadow-sm">
                <div className="flex gap-6 mb-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {sendSummary.total}
                    </div>
                    <div className="text-xs text-gray-500">전체</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {sendSummary.sent}
                    </div>
                    <div className="text-xs text-gray-500">성공</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">
                      {sendSummary.failed}
                    </div>
                    <div className="text-xs text-gray-500">실패</div>
                  </div>
                </div>
                {sendResults && (
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {sendResults.map((r, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded ${
                          r.success ? "bg-green-50" : "bg-red-50"
                        }`}
                      >
                        <span>{r.success ? "V" : "X"}</span>
                        <span>{r.email}</span>
                        {r.error && (
                          <span className="text-red-500 ml-auto">
                            {r.error}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 4: History ──────────────────────────────────── */}
        {tab === 4 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                발송 히스토리
              </h2>
              <button
                onClick={() => {
                  setHistoryLoading(true);
                  fetch(`/api/projects/${projectId}/history`)
                    .then((r) => r.json())
                    .then((data) => {
                      setHistory(data);
                      setHistoryLoading(false);
                    });
                }}
                className="text-sm px-3.5 py-1.5 border border-gray-200 rounded-xl hover:bg-gray-50 font-medium"
              >
                새로고침
              </button>
            </div>

            {historyLoading ? (
              <div className="text-center py-8 text-gray-500">로딩 중...</div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                아직 발송 기록이 없습니다
              </div>
            ) : (
              <div className="bg-white border border-gray-200/60 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                        시간
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                        수신자
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                        제목
                      </th>
                      <th className="text-left px-4 py-2.5 font-medium text-gray-600">
                        상태
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr
                        key={h.id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(h.sentAt).toLocaleString("ko-KR")}
                        </td>
                        <td className="px-4 py-2">
                          <div className="text-sm">{h.recipientEmail}</div>
                          {h.recipientName && (
                            <div className="text-xs text-gray-500">
                              {h.recipientName}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-700 max-w-xs truncate">
                          {h.subject}
                        </td>
                        <td className="px-4 py-2">
                          {h.success ? (
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full font-medium">
                              성공
                            </span>
                          ) : (
                            <span
                              className="text-xs bg-red-100 text-red-700 px-2.5 py-0.5 rounded-full font-medium cursor-help"
                              title={h.errorMessage || ""}
                            >
                              실패
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
