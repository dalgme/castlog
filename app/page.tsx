import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/** 단계 1 검증용 임시 페이지 — 단계 3에서 랜딩페이지로 교체된다. */
export default function Home() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-16">
      <Badge>CASTLOG</Badge>
      <h1 className="text-3xl font-bold text-brand-navy">
        캐스트로그 — 프로젝트 관리부터 전자결재까지
      </h1>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>단계 1 초기화 확인</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button>무료 체험 시작</Button>
          <Button variant="outline">제품 소개</Button>
        </CardContent>
      </Card>
    </main>
  );
}
