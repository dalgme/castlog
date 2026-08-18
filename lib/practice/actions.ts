"use server";

import { revalidatePath } from "next/cache";

import {
  enterPracticeMode,
  exitPracticeMode,
  type PracticeSwitchResult,
} from "./server";

/** 연습모드 진입 — 이후 모든 화면이 연습 데이터만 보여준다. */
export async function enterPractice(): Promise<PracticeSwitchResult> {
  const res = await enterPracticeMode();
  if (res.ok) revalidatePath("/[tenantSlug]", "layout");
  return res;
}

/** 연습모드 종료 — 실제 업무 데이터로 돌아간다. */
export async function exitPractice(): Promise<PracticeSwitchResult> {
  const res = await exitPracticeMode();
  if (res.ok) revalidatePath("/[tenantSlug]", "layout");
  return res;
}
