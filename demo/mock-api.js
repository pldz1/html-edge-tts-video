(() => {
  "use strict";

  const nativeFetch = window.fetch.bind(window);
  const scriptUrl = document.currentScript?.src || window.location.href;
  const demoBase = new URL("./", scriptUrl);
  const now = "2026-07-16T08:00:00+00:00";
  const unavailableMessage = "这是 Preview Demo 页面；请 clone 项目并在本地运行后使用此功能。";

  const projectData = {
    starter: {
      id: "starter", name: "Starter", aspectRatio: "16:9", language: "zh-CN",
      resolvedLanguage: "zh-CN", relativePath: "demo/fixtures/starter",
      sceneCount: 4, narrationChars: 92, duration: 38,
    },
    ocean: {
      id: "ocean", name: "海洋里的微型世界", aspectRatio: "16:9", language: "zh-CN",
      resolvedLanguage: "zh-CN", relativePath: "demo/fixtures/ocean",
      sceneCount: 4, narrationChars: 92, duration: 38,
    },
    orbit: {
      id: "orbit", name: "From Idea to Orbit", aspectRatio: "16:9", language: "en-US",
      resolvedLanguage: "en-US", relativePath: "demo/fixtures/orbit",
      sceneCount: 4, narrationChars: 218, duration: 44,
    },
  };

  const scenes = {
    starter: [
      ["intro", "开场", "看不见的海洋主角", 0, 8, "每一滴海水，都藏着一套正在运转的生命系统。"],
      ["scale", "尺度", "一滴水，一座宇宙", 8, 17, "从细菌到浮游动物，大小相差数千倍。"],
      ["network", "网络", "能量如何层层传递", 17, 28, "光能从藻类出发，沿着食物网抵达更大的生命。"],
      ["cycle", "循环", "微小生命的全球作用", 28, 38, "它们把碳带向深海，悄悄影响整个地球。"],
    ],
    ocean: [
      ["intro", "开场", "看不见的海洋主角", 0, 8, "每一滴海水，都藏着一套正在运转的生命系统。"],
      ["scale", "尺度", "一滴水，一座宇宙", 8, 17, "从细菌到浮游动物，大小相差数千倍。"],
      ["network", "网络", "能量如何层层传递", 17, 28, "光能从藻类出发，沿着食物网抵达更大的生命。"],
      ["cycle", "循环", "微小生命的全球作用", 28, 38, "它们把碳带向深海，悄悄影响整个地球。"],
    ],
    orbit: [
      ["intro", "OPEN", "A question worth launching", 0, 10, "Great missions begin with one useful question, not a rocket."],
      ["design", "DESIGN", "Turn constraints into form", 10, 21, "Payload, power, mass, and time become a system that can fly."],
      ["test", "TEST", "Prove it before flight", 21, 33, "Shake it, heat it, cool it, then trust what the evidence says."],
      ["orbit", "ORBIT", "A small machine, now useful", 33, 44, "One precise orbit turns engineering into everyday information."],
    ],
  };

  const voices = [
    { id: "zh-CN-XiaoxiaoNeural", label: "晓晓", locale: "zh-CN", gender: "Female" },
    { id: "zh-CN-YunxiNeural", label: "云希", locale: "zh-CN", gender: "Male" },
    { id: "en-US-JennyNeural", label: "Jenny", locale: "en-US", gender: "Female" },
    { id: "en-US-GuyNeural", label: "Guy", locale: "en-US", gender: "Male" },
  ];

  function activeId() {
    const value = sessionStorage.getItem("preview-demo:active-project") || "ocean";
    return projectData[value] ? value : "ocean";
  }

  function projectRecord(id) {
    return {
      ...projectData[id], active: id === activeId(), system: id === "starter",
      readOnly: id === "starter", updatedAt: now,
    };
  }

  function projectsPayload() {
    return { projects: Object.keys(projectData).map(projectRecord) };
  }

  function studioState() {
    const id = activeId();
    const project = projectData[id];
    return {
      activeProject: projectRecord(id), hasStarter: true,
      projectSummary: {
        hasSource: true, title: project.name, sceneCount: project.sceneCount,
        narrationChars: project.narrationChars,
      },
      settings: { tts: { voice: "zh-CN-XiaoxiaoNeural", rate: "+12%", pitch: "+0Hz", gap: "0.28" } },
      timeline: { exists: true, hasNarration: false, matchesSource: true, duration: project.duration },
      projectCount: Object.keys(projectData).length, outputs: [],
      urls: {
        studio: "/studio", shell: `${demoBase.href}preview.html?project=${id}`,
        captions: "/captions", voices: "/voices",
      },
      guide: {
        stage: "ready", title: "Preview Demo 已就绪",
        body: "页面功能仅供预览；请 clone 项目并在本地运行后执行实际任务。",
      },
    };
  }

  function captionsPayload() {
    const id = activeId();
    const project = projectData[id];
    const projectScenes = scenes[id];
    const sceneItems = projectScenes.map(([sceneId, category, title, start, end]) => ({
      id: sceneId, category, title, start, end,
    }));
    const cues = projectScenes.map(([sceneId, , , start, end, text], index) => ({
      id: `cue-${index + 1}`, scene_id: sceneId, start, end, text,
    }));
    const captions = { version: 1, cues };
    return {
      captions, generated: captions, saved: false, duration: project.duration,
      scenes: sceneItems, previewUrl: `${demoBase.href}preview.html?project=${id}`,
      aspectRatio: project.aspectRatio, sourcePath: null, sourceUrl: null,
    };
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  function unavailable() {
    return jsonResponse({ ok: false, error: unavailableMessage }, 409);
  }

  async function readPayload(options) {
    if (!options?.body) return {};
    try { return JSON.parse(options.body); } catch { return {}; }
  }

  window.fetch = async (input, options = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || input, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return nativeFetch(input, options);
    }

    const method = String(options.method || request?.method || "GET").toUpperCase();
    if (method === "GET") {
      if (url.pathname === "/api/studio/state") return jsonResponse(studioState());
      if (url.pathname === "/api/projects") return jsonResponse(projectsPayload());
      if (url.pathname === "/api/outputs") return jsonResponse({ outputs: [] });
      if (url.pathname === "/api/captions") return jsonResponse(captionsPayload());
      if (url.pathname === "/api/voice-preview") {
        return jsonResponse({ voices, manifest: { samples: [] }, history: [], outputUrl: null });
      }
      return unavailable();
    }

    if (method === "POST" && url.pathname === "/api/projects/activate") {
      const payload = await readPayload(options);
      const id = String(payload.project || "");
      if (!projectData[id]) return jsonResponse({ ok: false, error: "Demo project not found." }, 404);
      sessionStorage.setItem("preview-demo:active-project", id);
      return jsonResponse({ ok: true, project: projectRecord(id), state: studioState() });
    }

    return unavailable();
  };
})();
