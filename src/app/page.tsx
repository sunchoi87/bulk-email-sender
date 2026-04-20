"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SIGNATURE } from "@/lib/default-signature";

interface Project {
  id: string;
  name: string;
  senderName: string;
  globalBcc: string;
  createdAt: string;
  updatedAt: string;
}

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSender, setNewSender] = useState("Sun Choi");
  const [newBcc, setNewBcc] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        senderName: newSender,
        globalBcc: newBcc,
        signature: DEFAULT_SIGNATURE,
      }),
    });
    const project = await res.json();
    if (project.id) {
      router.push(`/project/${project.id}`);
    }
    setCreating(false);
  };

  const deleteProject = async (id: string, name: string) => {
    if (
      !confirm(
        `"${name}" 프로젝트를 삭제하시겠습니까?\n모든 수신자 및 발송 기록이 삭제됩니다.`
      )
    )
      return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    fetchProjects();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "방금 전";
    if (mins < 60) return `${mins}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return d.toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200/60 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
              Bulk Email Sender
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              2080 Ventures
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] shadow-sm shadow-blue-200"
          >
            + 새 프로젝트
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Create project modal-like card */}
        {showCreate && (
          <div className="mb-8 animate-in">
            <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 border border-gray-200/60 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-6">
                새 프로젝트 만들기
              </h2>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    프로젝트 이름
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="예: SpaceX NDA 발송, Fund III LP Update"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none placeholder:text-gray-400"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && createProject()}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      발신자 이름
                    </label>
                    <input
                      type="text"
                      value={newSender}
                      onChange={(e) => setNewSender(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      글로벌 BCC
                    </label>
                    <input
                      type="text"
                      value={newBcc}
                      onChange={(e) => setNewBcc(e.target.value)}
                      placeholder="선택사항"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none placeholder:text-gray-400"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={createProject}
                    disabled={!newName.trim() || creating}
                    className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] shadow-sm shadow-blue-200"
                  >
                    {creating ? "생성 중..." : "프로젝트 생성"}
                  </button>
                  <button
                    onClick={() => setShowCreate(false)}
                    className="px-6 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Project list */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 && !showCreate ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <svg
                className="w-8 h-8 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              아직 프로젝트가 없습니다
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              프로젝트를 만들어 대량 이메일을 발송하세요
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] shadow-sm shadow-blue-200"
            >
              첫 프로젝트 만들기
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-500 mb-4">
              {projects.length}개 프로젝트
            </p>
            {projects.map((p) => (
              <div
                key={p.id}
                className="bg-white rounded-xl border border-gray-200/60 p-5 hover:border-blue-300 hover:shadow-md hover:shadow-blue-100/50 cursor-pointer group"
                onClick={() => router.push(`/project/${p.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 truncate group-hover:text-blue-700">
                          {p.name}
                        </h3>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500">
                            {p.senderName}
                          </span>
                          <span className="text-gray-300">|</span>
                          <span className="text-xs text-gray-400">
                            수정 {formatDate(p.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100">
                      열기 →
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteProject(p.id, p.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50"
                      title="삭제"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
