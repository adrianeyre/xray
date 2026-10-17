export const packageName = "@xray/site";

export { INSTALL_STEPS, REQUIREMENTS, type InstallStep } from "./install.js";
export { PACKAGE_NAME, REPOSITORY_URL, SITE_URL } from "./project.js";
export {
  formatVerifiedInstall,
  verifyInstall,
  type StepRun,
  type VerifiedInstall,
  type VerifyInstallOptions,
} from "./verify-install.js";
