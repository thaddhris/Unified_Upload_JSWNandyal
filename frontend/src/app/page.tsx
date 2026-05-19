"use client";

import * as React from "react";
import { Shell } from "../components/Shell";
import { Dashboard } from "../components/Dashboard";
import { UnifiedUploadModal } from "../components/UnifiedUploadModal";
import { PreviewScreen } from "../components/PreviewScreen";
import { SuccessScreen } from "../components/SuccessScreen";
import {
  type EntryConfig,
  type UploadFileResult,
  makeResultFromParse,
  makeResultNoData,
} from "../lib/mockData";
import { type ParsedSheet } from "../lib/parseUpload";

type Stage = "dashboard" | "uploadModal" | "preview" | "success";

export default function Page() {
  const [stage, setStage] = React.useState<Stage>("dashboard");
  const [results, setResults] = React.useState<UploadFileResult[]>([]);
  const [fileName, setFileName] = React.useState("");

  const handleProceed = (configs: EntryConfig[], fname: string, parsedSheets: ParsedSheet[]) => {
    setFileName(fname);
    const byId = new Map<string, ParsedSheet>();
    for (const s of parsedSheets) {
      if (s.configId) byId.set(s.configId, s);
    }
    const providedIds = parsedSheets
      .map((s) => s.configId)
      .filter((id): id is string => !!id);

    const next: UploadFileResult[] = configs.map((c) => {
      const matched = byId.get(c.id);
      const parsed = makeResultFromParse(c, matched);
      if (parsed) return parsed;
      return makeResultNoData(c, providedIds);
    });

    setResults(next);
    setStage("preview");
  };

  return (
    <Shell>
      {stage === "dashboard" && (
        <Dashboard onOpenUnified={() => setStage("uploadModal")} />
      )}

      {stage === "uploadModal" && (
        <>
          <Dashboard onOpenUnified={() => setStage("uploadModal")} />
          <UnifiedUploadModal
            onClose={() => setStage("dashboard")}
            onProceed={handleProceed}
          />
        </>
      )}

      {stage === "preview" && (
        <PreviewScreen
          fileName={fileName}
          results={results}
          onBack={() => setStage("dashboard")}
          onReupload={() => setStage("uploadModal")}
          onConfirm={() => setStage("success")}
        />
      )}

      {stage === "success" && (
        <SuccessScreen
          fileName={fileName}
          results={results}
          onDone={() => {
            setStage("dashboard");
            setResults([]);
            setFileName("");
          }}
          onAnother={() => setStage("uploadModal")}
        />
      )}
    </Shell>
  );
}
