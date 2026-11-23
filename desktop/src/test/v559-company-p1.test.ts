import { describe, expect, it } from "vitest";
import { newPerson } from "../domain/models";
import { pendingCompanyPeopleInputs } from "../screens/NewCompany";
import { filterPeople } from "../screens/People";

describe("5.5.9 人员筛选约束详情目标", () => {
  it("只返回姓名或别名命中的人员，并在零结果时清空可操作目标", () => {
    const alice = newPerson("Alice Tan");
    alice.aliases = ["陈爱丽"];
    const bob = newPerson("Bob Lim");
    expect(filterPeople([bob, alice], "陈爱丽").map((person) => person.id)).toEqual([alice.id]);
    expect(filterPeople([bob, alice], "不存在的人")).toEqual([]);
  });
});

describe("5.5.9 新建公司关系输入必须明确确认", () => {
  it("空白可留空，未选候选的股东或董事文字会被识别为待处理", () => {
    expect(pendingCompanyPeopleInputs("  ", "")).toEqual({ shareholder: false, director: false });
    expect(pendingCompanyPeopleInputs("现有股东", "")).toEqual({ shareholder: true, director: false });
    expect(pendingCompanyPeopleInputs("", "现有董事")).toEqual({ shareholder: false, director: true });
  });
});
