import { createContext, useContext } from "react";
import { ArrowUpRight } from "lucide-react";
import { Notice } from "./ui";

export const GITHUB_URL = "https://github.com/TruncateCorn117/modelops-lab";
export const PublicDemoContext = createContext(false);
export const usePublicDemo = () => useContext(PublicDemoContext);

export function LocalDeploymentNotice() {
  const publicDemo = usePublicDemo();
  if (!publicDemo) return null;
  return (
    <Notice>
      公开演示支持合成工单体验和已有报告浏览。修改模型、导入数据与创建评测，
      <a
        href={GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="text-link"
      >
        请本地部署完整版本 <ArrowUpRight size={14} />
      </a>
      。
    </Notice>
  );
}
