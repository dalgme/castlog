import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatKrMobile } from "@/lib/auth/phone";

import { getDocumentImportStatus } from "./document-actions";

/**
 * 파일 등록 현황 (누적) — 자사 관계 전문가별 서류 보유 표 (기획 확정 2026-08-23).
 * 유무는 자사가 볼 권리가 있는 서류(자사 제공분 + 전문가가 허용한 유형) 기준.
 */

function Presence({ has }: { has: boolean }) {
  return has ? (
    <span className="font-semibold text-emerald-600">O</span>
  ) : (
    <span className="text-muted-foreground">-</span>
  );
}

export async function DocumentStatusSection() {
  const result = await getDocumentImportStatus();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">파일 등록 현황 (누적)</CardTitle>
        <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
          자사 관계 전문가별 서류 보유 현황입니다. 유무는 자사가 열람할 수 있는
          서류(자사가 등록한 파일 + 전문가가 허용한 서류) 기준으로 표시됩니다.
        </p>
      </CardHeader>
      <CardContent>
        {!result.ok ? (
          <p className="text-sm text-muted-foreground">{result.error}</p>
        ) : result.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            자사 관계 전문가가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>전문가명</TableHead>
                  <TableHead>소속</TableHead>
                  <TableHead>직위</TableHead>
                  <TableHead>연락처</TableHead>
                  <TableHead>이메일</TableHead>
                  <TableHead className="text-center">이력서</TableHead>
                  <TableHead className="text-center">신분증사본</TableHead>
                  <TableHead className="text-center">통장사본</TableHead>
                  <TableHead className="text-center">통합본</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={row.expertId}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {row.name}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {row.organization ?? "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {row.jobTitle ?? "-"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatKrMobile(row.phone)}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs">
                      {row.email ?? "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Presence has={row.hasResume} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Presence has={row.hasIdCard} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Presence has={row.hasBank} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Presence has={row.hasCombined} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
