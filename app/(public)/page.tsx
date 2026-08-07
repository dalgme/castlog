import Link from "next/link";
import "./landing.css";

export const metadata = {
  title: "CASTLOG 캐스트로그 — 프로젝트 관리부터 전자결재까지, 한 번에.",
  description:
    "창업교육·창업컨설팅 기업을 위한 통합 플랫폼 캐스트로그. 프로젝트 생성부터 전문가 섭외, 전자결재, 지급, 보고서 관리까지 21단계 워크플로우로 체계적으로 관리하세요.",
};

/** 랜딩페이지 (Claude Design 핸드오프 v2 시안) — 정적 index.html에서 포팅 */
export default function LandingPage() {
  return (
    <>
      
      
      {/* 로고 심볼 정의 (페이지 전체에서 <use>로 재사용) */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <defs>
          <linearGradient id="clgBody" x1="0.15" y1="0" x2="0.5" y2="1">
            <stop offset="0" stopColor="#1A68F0" />
            <stop offset="1" stopColor="#0A55DA" />
          </linearGradient>
          <linearGradient id="clgTop" x1="0.2" y1="0" x2="0.7" y2="1">
            <stop offset="0" stopColor="#7CB1FD" />
            <stop offset="1" stopColor="#5A98FB" />
          </linearGradient>
          <linearGradient id="clgAmber" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor="#FFBE1A" />
            <stop offset="1" stopColor="#F9AB00" />
          </linearGradient>
          <g id="clgSym" strokeLinejoin="round" strokeWidth="4">
            <polygon points="51.5,0 0,33.2 0,89.8 51.5,123 51.5,94.1 25.2,76.3 25.2,46.7 51.5,29.5" fill="url(#clgBody)" stroke="url(#clgBody)" />
            <polygon points="25.2,46.7 0,59 0,86 19,92.3 41.7,116.9 51.5,123 51.5,94.1 25.2,76.3" fill="#0A429F" stroke="#0A429F" strokeWidth="1.5" />
            <polygon points="51.5,0 100,33.2 100,41.8 89,52.9 76.5,52.9 76.5,46.7 51.5,29.5" fill="url(#clgTop)" stroke="url(#clgTop)" />
            <polygon points="51.5,123 100,89.8 100,81.2 89,70.1 76.5,70.1 76.5,76.3 51.5,94.1" fill="url(#clgAmber)" stroke="url(#clgAmber)" />
          </g>
        </defs>
      </svg>
      
      {/* ===================== Header ===================== */}
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="#product" aria-label="CASTLOG 캐스트로그 홈">
            <svg className="brand-mark" width="30" height="37" viewBox="-2 -2 104 127" aria-hidden="true"><use href="#clgSym" /></svg>
            <span className="brand-text">
              <span className="brand-name"><i className="c-navy">CAST</i><i className="c-blue">L</i><i className="c-amber">O</i><i className="c-blue">G</i></span>
              <span className="brand-sub">캐스트로그</span>
            </span>
          </a>
      
          <nav className="gnb" aria-label="주 메뉴">
            <a href="#product">제품</a>
            <a href="#features">기능</a>
            <a href="#approval">전자결재</a>
            <a href="#experts">전문가 관리</a>
            <a href="#pricing">요금 안내</a>
            <a href="#support">고객지원</a>
          </nav>
      
          <div className="header-actions">
            <Link className="btn-login" href="/login">로그인</Link>
            <a className="btn-trial" href="#pricing">무료 체험 신청</a>
          </div>
        </div>
      </header>
      
      {/* ===================== Hero ===================== */}
      <section className="hero" id="product">
        <div className="container hero-inner">
          <div className="hero-copy">
            <span className="hero-badge">창업교육·창업컨설팅 기업을 위한 통합 플랫폼</span>
            <h1 className="hero-title">프로젝트 관리부터<br /><em>전자결재</em>까지<br />한 번에, 완벽하게</h1>
            <p className="hero-desc">프로젝트 생성부터 전문가 섭외, 결재, 지급, 보고서 관리까지<br />21단계 워크플로우로 체계적으로 관리하고<br />의사결정을 빠르고 안전하게 진행하세요.</p>
            <div className="hero-cta">
              <a className="btn-primary" href="#pricing">무료 체험 시작</a>
              <a className="btn-secondary" href="mailto:hello@castlog.kr?subject=%EC%BA%90%EC%8A%A4%ED%8A%B8%EB%A1%9C%EA%B7%B8%20%EC%A0%9C%ED%92%88%20%EC%86%8C%EA%B0%9C%EC%84%9C%20%EC%9A%94%EC%B2%AD">제품 소개 다운로드
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M4 20h16" /></svg>
              </a>
            </div>
            <div className="hero-checks">
              <span className="hero-check"><svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#246BFF" /><path d="M7.5 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>30일 무료 체험</span>
              <span className="hero-check"><svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#246BFF" /><path d="M7.5 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>카드 등록 없이 사용</span>
              <span className="hero-check"><svg width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#246BFF" /><path d="M7.5 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>전문가 온보딩 지원</span>
            </div>
          </div>
      
          {/* ---------- Dashboard mockup ---------- */}
          <div className="mock" aria-hidden="true">
            <aside className="mock-side">
              <div className="mock-side-brand">
                <svg width="20" height="25" viewBox="-2 -2 104 127"><use href="#clgSym" /></svg>
                <span className="mock-side-word"><i className="w-white">CAST</i><i className="w-sky">L</i><i className="w-amber">O</i><i className="w-sky">G</i></span>
              </div>
              <nav className="mock-menu">
                <span className="mm active"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10.5L12 4l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1z" /></svg>대시보드</span>
                <span className="mm"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5" /></svg>프로젝트</span>
                <span className="mm"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h9l4 4v14H6z" /><path d="M9 13l2 2 4-4" /></svg>전자결재</span>
                <span className="mm"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="3.4" /><path d="M5 20c1.6-3.6 4-5.4 7-5.4s5.4 1.8 7 5.4" /></svg>전문가</span>
                <span className="mm"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19V9M10 19V5M16 19v-6M4 19h16" /></svg>비용·지급</span>
                <span className="mm"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>보고서</span>
                <span className="mm"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8.5" /></svg>설정</span>
              </nav>
            </aside>
      
            <div className="mock-main">
              <div className="mock-topbar">
                <span className="mock-topbar-title">대시보드</span>
                <div className="mock-top-right">
                  <span className="mock-tenant">(주)넥스트랩
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M6 9l6 6 6-6" /></svg>
                  </span>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#7A879C" strokeWidth="1.8"><path d="M18 15v-4a6 6 0 10-12 0v4l-1.5 3h15z" /><path d="M10 20h4" /></svg>
                  <span className="mock-avatar">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="#7A879C"><circle cx="12" cy="9" r="3.4" /><path d="M5.5 20c1.5-3.4 3.9-5 6.5-5s5 1.6 6.5 5z" /></svg>
                  </span>
                </div>
              </div>
      
              <div className="mock-body">
                <div className="mock-stats">
                  <div className="stat"><span className="stat-label">진행 중 프로젝트</span><span className="stat-value">24</span><span className="stat-delta">↑ 12%</span></div>
                  <div className="stat"><span className="stat-label">전자결재 대기</span><span className="stat-value">7건</span><span className="stat-delta">↑ 3건</span></div>
                  <div className="stat"><span className="stat-label">이번 달 지급</span><span className="stat-value stat-value-sm">38,450,000<small>원</small></span><span className="stat-delta">↑ 8.2%</span></div>
                  <div className="stat"><span className="stat-label">전문가 Pool</span><span className="stat-value">256명</span><span className="stat-delta">↑ 18명</span></div>
                </div>
      
                <div className="mock-mid">
                  <div className="mock-card mock-projects">
                    <div className="mock-card-title">최근 프로젝트 현황</div>
                    <div className="mp-row"><span className="mp-name">2024 창업중심대학 예비창업자 모집</span><span className="mp-right"><span className="tag tag-blue">진행 중</span><span className="mp-pct">65%</span></span></div>
                    <div className="mp-row"><span className="mp-name">2024 예비창업패키지 멘토링</span><span className="mp-right"><span className="tag tag-blue">진행 중</span><span className="mp-pct">40%</span></span></div>
                    <div className="mp-row"><span className="mp-name">창업교육 워크숍 (7월)</span><span className="mp-right"><span className="tag tag-amber">기획 중</span><span className="mp-pct">20%</span></span></div>
                    <div className="mp-row"><span className="mp-name">2024 초기창업패키지 IR 데모데이</span><span className="mp-right"><span className="tag tag-gray">완료</span><span className="mp-pct">100%</span></span></div>
                    <a className="mp-more" href="#projects">전체 프로젝트 보기 →</a>
                  </div>
      
                  <div className="mock-card mock-approval">
                    <div className="mock-card-title">전자결재 현황</div>
                    <div className="donut-wrap">
                      <div className="donut">
                        <div className="donut-center"><small>총</small><strong>32건</strong></div>
                      </div>
                      <div className="donut-legend">
                        <span><i style={{ background: "#C9DBFF" }}></i>결재 대기<b>7건</b></span>
                        <span><i style={{ background: "#6CA8FF" }}></i>진행 중<b>15건</b></span>
                        <span><i style={{ background: "#1D4FD8" }}></i>완료<b>10건</b></span>
                      </div>
                    </div>
                  </div>
                </div>
      
                <div className="mock-card mock-chart">
                  <div className="mock-card-title">이번 달 지급 추이</div>
                  <div className="chart">
                    <div className="chart-y"><span>30M</span><span>20M</span><span>10M</span><span>0</span></div>
                    <div className="chart-bars">
                      <div className="cb"><i style={{ height: "42px" }}></i></div>
                      <div className="cb"><i style={{ height: "62px" }}></i></div>
                      <div className="cb"><i style={{ height: "74px" }}></i></div>
                      <div className="cb"><i style={{ height: "96px", background: "#1D4FD8" }}></i></div>
                      <div className="cb"><i style={{ height: "56px" }}></i></div>
                    </div>
                    <div></div>
                    <div className="chart-x"><span>1주</span><span>2주</span><span>3주</span><span>4주</span><span>5주</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* ===================== Core values ===================== */}
      <section className="values" id="features">
        <div className="container">
          <div className="values-eyebrow">CASTLOG 핵심 가치</div>
          <div className="values-grid">
            <div className="value">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#12294D" strokeWidth="1.5" strokeLinejoin="round"><path d="M12 3l7 3v5.5c0 4.3-2.9 7.9-7 9.5-4.1-1.6-7-5.2-7-9.5V6z" /><path d="M9 12l2 2 4-4" strokeLinecap="round" /></svg>
              <div className="value-title">10계층 보안</div>
              <div className="value-desc">민감정보 안전 관리</div>
            </div>
            <div className="value">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#12294D" strokeWidth="1.5"><circle cx="9" cy="8" r="3.2" /><path d="M3 19c1.3-3.2 3.4-4.8 6-4.8s4.7 1.6 6 4.8" strokeLinecap="round" /><circle cx="17.5" cy="7" r="2.4" /><path d="M15.5 13.6c2.4-.5 4.3.9 5.5 4.4" strokeLinecap="round" /></svg>
              <div className="value-title">전문가 신원 관리</div>
              <div className="value-desc">공유 신원 모델</div>
            </div>
            <div className="value">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#12294D" strokeWidth="1.5" strokeLinejoin="round"><path d="M5 3h9l4 4v13H5z" /><path d="M8 9h6M8 12.5h4" strokeLinecap="round" /><circle cx="17" cy="17" r="4.2" fill="#FFB000" stroke="none" /><path d="M15.2 17.1l1.3 1.3 2.4-2.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
              <div className="value-title">전자결재 엔진</div>
              <div className="value-desc">조건부 라우팅 · 대결 · 병렬합의</div>
            </div>
            <div className="value">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#12294D" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M8 8l2.2 4M16 8l-2.2 4M12 12v4M9.5 14h5M9.5 16.4h5" strokeLinecap="round" /></svg>
              <div className="value-title">비용·지급 관리</div>
              <div className="value-desc">지급유형 분기 · 일정 관리</div>
            </div>
            <div className="value">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#12294D" strokeWidth="1.5" strokeLinejoin="round"><path d="M3 7a1 1 0 011-1h5l2 2.4h9a1 1 0 011 1V18a1 1 0 01-1 1H4a1 1 0 01-1-1z" /><path d="M3 11h18" /></svg>
              <div className="value-title">서류 자동 관리</div>
              <div className="value-desc">암호화 저장 · 자동 파기</div>
            </div>
            <div className="value">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#12294D" strokeWidth="1.5" strokeLinejoin="round"><path d="M7.5 18.5a4.5 4.5 0 01-.6-8.96 5.5 5.5 0 0110.5-1.2A4.25 4.25 0 0117.5 18.5z" /></svg>
              <div className="value-title">멀티테넌트 SaaS</div>
              <div className="value-desc">화이트라벨 지원</div>
            </div>
          </div>
        </div>
      </section>
      
      {/* ===================== Problem / Solution ===================== */}
      <section className="solution" id="approval">
        <div className="container solution-inner">
          <div className="prob-card">
            <div className="ps-title">아직도 이런 문제로 힘드신가요?</div>
            <div className="ps-list">
              <div className="ps-item"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#EF4B3C" /><path d="M12 7v6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.6" r="1.25" fill="#fff" /></svg>프로젝트마다 엑셀, 메신저, 이메일로 관리되어 비효율적</div>
              <div className="ps-item"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#EF4B3C" /><path d="M12 7v6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.6" r="1.25" fill="#fff" /></svg>외부 전문가 섭외·계약·지급·보고가 분산되어 추적이 어려움</div>
              <div className="ps-item"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#EF4B3C" /><path d="M12 7v6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.6" r="1.25" fill="#fff" /></svg>전자결재가 없어 의사결정이 느리고 문서 관리가 복잡함</div>
              <div className="ps-item"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#EF4B3C" /><path d="M12 7v6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.6" r="1.25" fill="#fff" /></svg>세무·계약을 위한 관리가 번거롭고 실수가 발생해요</div>
              <div className="ps-item"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#EF4B3C" /><path d="M12 7v6" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /><circle cx="12" cy="16.6" r="1.25" fill="#fff" /></svg>반복 사업인데 매번 처음부터 다시 만들어야 해요</div>
            </div>
          </div>
      
          <div className="solution-center" aria-hidden="true">
            <div className="sc-arrow">
              <svg width="100%" height="10" viewBox="0 0 60 10" preserveAspectRatio="none"><path d="M0 5h48" stroke="#9CC0FF" strokeWidth="2" strokeDasharray="6 5" fill="none" /><path d="M48 1l8 4-8 4z" fill="#9CC0FF" /></svg>
            </div>
            <div className="solution-logo">
              <svg width="38" height="47" viewBox="-2 -2 104 127"><use href="#clgSym" /></svg>
              <span className="solution-logo-word"><i className="c-navy">CAST</i><i className="c-blue">L</i><i className="c-amber">O</i><i className="c-blue">G</i></span>
            </div>
            <div className="sc-arrow">
              <svg width="100%" height="10" viewBox="0 0 60 10" preserveAspectRatio="none"><path d="M0 5h48" stroke="#9CC0FF" strokeWidth="2" strokeDasharray="6 5" fill="none" /><path d="M48 1l8 4-8 4z" fill="#9CC0FF" /></svg>
            </div>
          </div>
      
          <div className="sol-card">
            <div className="ps-title ps-title-blue">캐스트로그가 해결합니다!</div>
            <div className="ps-list">
              <div className="ps-item ps-item-sol"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1D4FD8" /><path d="M7.6 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>21단계 프로젝트 워크플로우로 체계적인 관리</div>
              <div className="ps-item ps-item-sol"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1D4FD8" /><path d="M7.6 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>전문가 신원·서류 통합 관리로 중복 업무 제거</div>
              <div className="ps-item ps-item-sol"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1D4FD8" /><path d="M7.6 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>전자결재로 모든 의사결정을 빠르고 안전하게</div>
              <div className="ps-item ps-item-sol"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1D4FD8" /><path d="M7.6 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>세무·비용·증빙까지 자동화된 통합 관리</div>
              <div className="ps-item ps-item-sol"><svg width="19" height="19" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1D4FD8" /><path d="M7.6 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>프로젝트 복제로 시간 80% 절약</div>
            </div>
          </div>
        </div>
      </section>
      
      {/* ===================== 21-step workflow ===================== */}
      <section className="workflow" id="experts">
        <div className="container">
          <div className="wf-card">
            <div className="wf-copy">
              <div className="wf-eyebrow">21단계 워크플로우</div>
              <h2 className="wf-title">모든 프로젝트를<br />체계적으로 관리하세요</h2>
              <div className="wf-checks">
                <div className="wf-check"><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#F0A400" strokeWidth="1.6" /><path d="M8 12.4l2.8 2.8L16.3 9.4" stroke="#F0A400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>기획부터 완료까지 전 과정을 단계별 관리</div>
                <div className="wf-check"><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#F0A400" strokeWidth="1.6" /><path d="M8 12.4l2.8 2.8L16.3 9.4" stroke="#F0A400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>담당자·기한 설정으로 지연 업무 자동 알림</div>
                <div className="wf-check"><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#F0A400" strokeWidth="1.6" /><path d="M8 12.4l2.8 2.8L16.3 9.4" stroke="#F0A400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>AI 보조 검수로 문서 품질 향상</div>
                <div className="wf-check"><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.5" stroke="#F0A400" strokeWidth="1.6" /><path d="M8 12.4l2.8 2.8L16.3 9.4" stroke="#F0A400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>프로젝트 복제로 반복 업무 시간 80% 절약</div>
              </div>
              <a className="wf-btn" href="#pricing">자세히 보기 →</a>
            </div>
      
            <div className="wf-orbit" aria-hidden="true">
              <div className="orbit-core"><strong>21</strong><span>단계</span></div>
              <div className="orbit-chip" style={{ top: "22px", left: "6%" }}><b>01</b><span>기초정보</span></div>
              <div className="orbit-chip" style={{ top: "0", right: "8%" }}><b>02</b><span>공고정보</span></div>
              <div className="orbit-chip" style={{ top: "82px", right: "-4%" }}><b>03</b><span>견적서</span></div>
              <div className="orbit-chip" style={{ bottom: "82px", right: "-2%" }}><b>04</b><span>계약서</span></div>
              <div className="orbit-chip" style={{ bottom: "6px", right: "4%" }}><b>20</b><span>방명록 자동생성</span></div>
              <div className="orbit-chip" style={{ bottom: "34px", left: "2%" }}><b className="b-gray">21</b><span>완수보고서</span></div>
              <div className="orbit-dots" style={{ top: "128px", left: "-6%" }}>···</div>
              <div className="orbit-dots" style={{ bottom: "0", left: "34%" }}>···</div>
            </div>
      
            <div className="wf-example">
              <div className="wfe-label">프로젝트 진행 현황 예시</div>
              <div className="wfe-title">2024 창업교육 워크숍</div>
              <div className="wfe-progress">
                <div className="wfe-progress-labels"><span>진행률 65%</span><em>65%</em></div>
                <div className="wfe-bar"><i style={{ width: "65%" }}></i></div>
              </div>
              <div className="wfe-steps">
                <div className="wfe-step"><span className="wfe-name"><b>01</b>기초정보</span><span className="tag tag-gray">완료</span></div>
                <div className="wfe-step"><span className="wfe-name"><b>02</b>공고정보</span><span className="tag tag-gray">완료</span></div>
                <div className="wfe-step"><span className="wfe-name"><b>03</b>견적서</span><span className="tag tag-blue">진행 중</span></div>
                <div className="wfe-step"><span className="wfe-name"><b>04</b>계약서</span><span className="tag tag-wait">대기</span></div>
                <div className="wfe-step"><span className="wfe-name"><b>05</b>체크리스트 발행</span><span className="tag tag-wait">대기</span></div>
              </div>
              <a className="wfe-btn" href="#pricing">전체 단계 보기</a>
            </div>
          </div>
        </div>
      </section>
      
      {/* ===================== CTA ===================== */}
      <section className="cta" id="pricing">
        <div className="container">
          <div className="cta-inner">
            <div className="cta-copy">
              <div className="cta-title">지금 바로 캐스트로그를 경험해보세요</div>
              <div className="cta-sub">30일 무료 체험으로 모든 기능을 제한 없이 사용해보세요!</div>
              <div className="cta-actions">
                <a className="cta-btn-white" href="mailto:hello@castlog.kr?subject=%EC%BA%90%EC%8A%A4%ED%8A%B8%EB%A1%9C%EA%B7%B8%20%EB%AC%B4%EB%A3%8C%20%EC%B2%B4%ED%97%98%20%EC%8B%A0%EC%B2%AD">무료 체험 시작하기</a>
                <a className="cta-btn-line" href="mailto:hello@castlog.kr?subject=%EC%BA%90%EC%8A%A4%ED%8A%B8%EB%A1%9C%EA%B7%B8%20%EB%8F%84%EC%9E%85%20%EC%83%81%EB%8B%B4%20%EB%AC%B8%EC%9D%98">전문가에게 문의하기</a>
              </div>
            </div>
            <div className="cta-contact">
              <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.3" strokeLinejoin="round"><path d="M4 13v-1a8 8 0 0116 0v1" /><rect x="2.5" y="13" width="4.5" height="7" rx="2" /><rect x="17" y="13" width="4.5" height="7" rx="2" /><path d="M19 20v.5a2.5 2.5 0 01-2.5 2.5H13" strokeLinecap="round" /></svg>
              <div className="cta-contact-body">
                <div className="cta-contact-title">도입 상담이 필요하신가요?</div>
                <div className="cta-contact-sub">전문가가 직접 도와드립니다.</div>
                <a className="cta-contact-link cta-contact-tel" href="tel:0212345678">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#BFD5FF" strokeWidth="1.8"><path d="M4.5 5.5c0 8 6 14 14 14l1.5-3-4-2-2 2c-2.2-1.2-4.3-3.3-5.5-5.5l2-2-2-4z" strokeLinejoin="round" /></svg>02-1234-5678</a>
                <a className="cta-contact-link" href="mailto:hello@castlog.kr">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#BFD5FF" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5L12 13l8.5-6.5" /></svg>hello@castlog.kr</a>
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* ===================== Footer ===================== */}
      <footer className="site-footer" id="support">
        <div className="container footer-inner">
          <div className="footer-brand">
            <a className="brand" href="#product" aria-label="CASTLOG 캐스트로그">
              <svg width="26" height="32" viewBox="-2 -2 104 127" aria-hidden="true"><use href="#clgSym" /></svg>
              <span className="brand-text">
                <span className="brand-name brand-name-sm"><i className="c-navy">CAST</i><i className="c-blue">L</i><i className="c-amber">O</i><i className="c-blue">G</i></span>
                <span className="brand-sub brand-sub-sm">캐스트로그</span>
              </span>
            </a>
            <p>창업교육·창업컨설팅 기업의 성공적인<br />프로젝트 수행을 위한 통합 플랫폼</p>
          </div>
          <div className="footer-col">
            <div className="footer-head">제품</div>
            <a href="#features">기능 소개</a>
            <a href="#product">솔루션</a>
            <a href="#pricing">요금 안내</a>
            <a href="#updates">업데이트</a>
          </div>
          <div className="footer-col">
            <div className="footer-head">고객지원</div>
            <a href="#support">고객센터</a>
            <a href="#guide">사용 가이드</a>
            <a href="#faq">FAQ</a>
            <a href="#contact">문의하기</a>
          </div>
          <div className="footer-col">
            <div className="footer-head">회사</div>
            <a href="#about">회사소개</a>
            <a href="#blog">블로그</a>
            <a href="#careers">채용 정보</a>
            <a href="#partners">제휴 문의</a>
          </div>
          <div className="footer-col">
            <div className="footer-head">법적 고지</div>
            <a href="#privacy">개인정보처리방침</a>
            <a href="#terms">이용약관</a>
            <a href="#efin">전자금융거래 약관</a>
          </div>
        </div>
        <div className="container footer-bottom">
          <div className="footer-copyright">© 2024 NextLab(StartMate). All rights reserved.</div>
        </div>
      </footer>
      
    </>
  );
}
