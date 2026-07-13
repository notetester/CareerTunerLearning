import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const docsRoot = path.resolve("docs");

// 이전 기준선의 단정이 새 페이지에 다시 복사되는 것을 막는다. 과거를 설명해야 한다면
// 폐기된 문장을 그대로 인용하지 말고 현재 사실과 기준 SHA를 함께 서술한다.
const forbidden = [
  { label: "React 18 current-stack claim", pattern: /React\s*18(?:\.\d+)?/i },
  { label: "Vite 6 current-stack claim", pattern: /Vite\s*6(?:\.\d+)?/i },
  { label: "Spring Boot 4.0.6 claim", pattern: /Spring Boot\s*4\.0\.6/i },
  { label: "obsolete 68-table claim", pattern: /(?:^|[^\d])(?:약\s*)?68개\s*테이블/i },
  { label: "profile version absent claim", pattern: /user_profile_version.{0,60}(?:존재하지|스키마에\s*없|미구현)|(?:존재하지|스키마에\s*없|미구현).{0,60}user_profile_version/i },
  { label: "C model design-only claim", pattern: /(?:자체\s*(?:LLM|모델)|career-strategy).{0,80}(?:설계\s*단계|미구현)|(?:설계\s*단계|미구현).{0,80}(?:자체\s*(?:LLM|모델)|career-strategy)/i },
  { label: "release cleartext enabled claim", pattern: /androidScheme.{0,30}http.{0,80}cleartext.{0,20}true|cleartext.{0,20}true.{0,80}androidScheme.{0,30}http/i },
  { label: "correction placeholder claim", pattern: /첨삭.{0,50}(?:프론트|화면).{0,30}(?:플레이스홀더|미연결)|(?:플레이스홀더|미연결).{0,50}첨삭/i },
  { label: "billing unwired claim", pattern: /(?:AI\s*실행|첨삭).{0,70}(?:차감|과금).{0,40}(?:미연결|미호출|배선\s*전)|(?:차감|과금).{0,40}(?:미연결|미호출|배선\s*전)/i },
  { label: "plan recommendation missing claim", pattern: /(?:요금제\s*추천|#28).{0,50}미구현|미구현.{0,50}(?:요금제\s*추천|#28)/i },
];

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".vitepress") continue;
      files.push(...await markdownFiles(target));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(target);
    }
  }
  return files;
}

const violations = [];
for (const file of await markdownFiles(docsRoot)) {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        violations.push(`${path.relative(process.cwd(), file)}:${index + 1} [${rule.label}] ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error("오래된 현재-사실 단정이 발견되었습니다:\n");
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("stale claim gate 통과");
