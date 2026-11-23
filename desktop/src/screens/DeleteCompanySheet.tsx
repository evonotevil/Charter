import { useState } from "react";
import type { Company } from "../domain/models";
import { useApp } from "../state/hooks";
import { Button, Modal, SelectField, SheetScaffold } from "../ui/kit";

export function DeleteCompanySheet({ company, onClose, onDeleted }: { company: Company; onClose: () => void; onDeleted: () => void }) {
  const { store } = useApp();
  const [targetID, setTargetID] = useState("");
  const files = store.companyRemovalDocuments(company.id);
  const error = targetID ? store.companyTransferError(company.id, targetID) : null;
  return <Modal onClose={onClose}>
    <SheetScaffold title="删除公司" subtitle={company.name} width={520}
      trailing={<><Button autoFocus onClick={onClose}>取消</Button><Button kind="danger" disabled={!!error} onClick={() => {
        store.deleteCompany(company, targetID || undefined);
        onDeleted();
      }}>删除公司</Button></>}>
      <div className="col gap16">
        <p>删除后会移除这家公司的持股、任职和材料包发送记录。</p>
        {files.length > 0 && <>
          <div className="col gap8">
            <span className="t-row">文件归属 · {files.length} 份</span>
            <SelectField ariaLabel="文件归属" minWidth={0} value={targetID} onChange={setTargetID}
              options={[["", "保留原公司名称"], ...store.data.companies.filter((c) => c.id !== company.id).map((c): [string, string] => [c.id, `转移到 ${c.name}`])]} />
          </div>
          <p className="muted t-meta">包括现行文件、历史版本及废纸篓中的文件。{targetID ? "文件将归入所选公司，原件保留在当前位置。" : "在文件页仍可按原公司名称查找和打开。"}</p>
          {error && <p role="alert" className="danger-text t-meta">{error}</p>}
        </>}
      </div>
    </SheetScaffold>
  </Modal>;
}
