export const packageName = "@xray/core";

export {
  defaultEnginePath,
  startEngine,
  type EngineClient,
  type EngineExit,
  type EngineOptions,
} from "./engine/engine-client.js";
export { EngineError, type EngineErrorCode } from "./engine/engine-error.js";
export { ENGINE_PROTOCOL_VERSION, type EngineInfo } from "./engine/protocol.js";
export {
  MINIMUM_DOTNET_SDK_MAJOR,
  MINIMUM_NODE_MAJOR,
  runDoctor,
  type DoctorCheck,
  type DoctorCheckId,
  type DoctorOptions,
  type DoctorReport,
} from "./doctor/doctor.js";
export {
  listDotnetSdks,
  type DotnetSdk,
  type DotnetSdkLookup,
} from "./doctor/dotnet-sdks.js";
export {
  classifyInput,
  type InputClassification,
  type InputKind,
} from "./input/classify-input.js";
export {
  chooseInputAssembly,
  type InputAssemblyChoice,
} from "./input/choose-input-assembly.js";
export { InputError, type InputErrorCode } from "./input/input-error.js";
export {
  type Architecture,
  type AssemblyCounts,
  type AssemblyIdentity,
  type AssemblySummary,
  type Bitness,
  type EntryPoint,
  type ObfuscationCheck,
  type ObfuscationIndicator,
  type OutputKind,
  type PdbCheck,
  type PdbFormat,
  type PlatformTarget,
  type TargetFramework,
} from "./inspect/assembly-summary.js";
export {
  inspectAssembly,
  type Inspection,
} from "./inspect/inspect-assembly.js";
export {
  INSPECT_JSON_SCHEMA_VERSION,
  toInspectJson,
  type InspectJson,
} from "./inspect/inspect-json.js";
export {
  reconstruct,
  type Reconstruction,
  type ReconstructOptions,
  type ReconstructionWarning,
  type RecoveredProject,
  type RecoveredSolution,
} from "./reconstruct/reconstruct.js";
export {
  PROGRESS_INTERVAL_MS,
  RECONSTRUCTION_STAGES,
  type ProgressEvent,
  type ProgressListener,
  type ReconstructionStage,
} from "./reconstruct/progress.js";
export {
  ReconstructionError,
  type ReconstructionErrorCode,
} from "./reconstruct/reconstruction-error.js";
export {
  type PartialReason,
  type ReconstructionOutcome,
} from "./reconstruct/reconstruction-outcome.js";
export {
  toXrayReport,
  XRAY_REPORT_FILE,
  XRAY_REPORT_SCHEMA_VERSION,
  type AcceptedReconstruction,
  type ReconstructionTimings,
  type XrayReport,
} from "./reconstruct/xray-report.js";
export { type BuildDiagnostic } from "./reconstruct/build-diagnostics.js";
export { type SolutionBuild } from "./reconstruct/build-solution.js";
export { type ProgramRun, type RunStatus } from "./reconstruct/run-program.js";
export {
  type Dependency,
  type DependencyResolution,
} from "./reconstruct/sibling-assemblies.js";
export {
  RECOVERED_LANGUAGE_VERSION,
  type ProjectOutputType,
} from "./reconstruct/recovered-solution.js";
