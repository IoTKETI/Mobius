<script setup lang="ts">
/**
 * 이 서버의 ACP 운영 대원칙과 정책을 화면에 붙인다.
 *
 * 출처는 docs/superpowers/specs/2026-08-29-acp-operating-model.md 이고, 표의
 * 수치는 전부 그 문서의 실측이다. **문구를 여기서 새로 지어내지 않는다** —
 * 화면과 문서가 다른 말을 하면 둘 다 못 믿게 된다.
 *
 * 늘 보이는 것은 대원칙과 "기본 정책이 대체된다" 둘뿐이다. 나머지(템플릿·비트표·
 * 함정)는 접어 둔다 — 매번 다 읽히려 들면 아무것도 안 읽힌다.
 */
withDefaults(defineProps<{ variant?: 'full' | 'compact' }>(), { variant: 'full' })
</script>

<template>
  <div class="policy">
    <div class="principles">
      <h4>이 서버의 권한 대원칙</h4>
      <ol>
        <li><strong>생성·조회는 누구나</strong></li>
        <li><strong>수정·삭제는 생성자만</strong></li>
        <li><strong>잠글 곳만 명시적으로 잠근다</strong></li>
      </ol>
      <p class="tail">
        평소에는 아무것도 하지 않습니다. <code>acpi</code> 가 비어 있는 리소스는 이미 이
        규칙으로 돕니다. <strong>ACP 는 이 원칙의 예외를 표시하는 수단</strong>이지, 전체에
        깔고 시작하는 것이 아닙니다.
      </p>
    </div>

    <div class="alert">
      <h4>ACP 를 걸면 기본 정책이 <em>통째로 대체됩니다</em></h4>
      <p>
        덧붙는 것이 아니라 갈아치우는 것입니다. <code>pv.acr</code> 에 적힌 원본과
        <strong>생성자</strong>만 통과하고, 기본 정책의 “누구나 조회”는 사라집니다.
        적지 않은 팀·시스템은 그 순간부터 못 봅니다.
      </p>
      <p>
        <strong>생성자는 ACP 로 배제할 수 없습니다.</strong> 어떤 규칙을 써도 만든 주체는
        남으므로 “이 리소스를 완전히 잠갔다”는 말은 언제나 틀립니다. 그게 필요하면
        AE 를 나눠야 합니다.
      </p>
    </div>

    <template v-if="variant === 'full'">
      <details class="more">
        <summary>어디에 걸어야 하나 — <strong>AE 하나</strong></summary>
        <p>
          AE 에 한 번 붙이면 <strong>그 아래 트리 전체에 적용됩니다.</strong> 컨테이너의
          <code>la</code> 도, 탐색 결과도 함께 막힙니다.
        </p>
        <p>
          그래서 <strong>컨테이너나 CIN 에는 붙이지 않습니다.</strong> 상속되므로 붙일 이유가
          없고, 붙이는 순간 관리 대상이 수만 개가 됩니다. 한 AE 안에서 일부만 다르게 해야
          한다면 대개 <strong>AE 를 나누라는 신호</strong>입니다.
        </p>
        <p class="warn">
          컨테이너에 걸면 조상 것과 <strong>합쳐지지 않고 덮어씁니다</strong> — 가장 가까운
          것 하나만 쓰입니다. 중간 컨테이너에 <code>acpi</code> 가 생기면 AE 의 ACP 를
          고쳐도 먹지 않습니다.
        </p>
      </details>

      <details class="more">
        <summary><code>acop</code> 비트 — 63 이 무슨 뜻인가</summary>
        <table class="bits">
          <thead>
            <tr><th>비트</th><th>연산</th><th>비트</th><th>연산</th></tr>
          </thead>
          <tbody>
            <tr><td><code>1</code></td><td>CREATE</td><td><code>8</code></td><td>DELETE</td></tr>
            <tr><td><code>2</code></td><td>RETRIEVE</td><td><code>16</code></td><td>NOTIFY</td></tr>
            <tr><td><code>4</code></td><td>UPDATE</td><td><code>32</code></td><td>DISCOVERY</td></tr>
          </tbody>
        </table>
        <p class="combos">
          자주 쓰는 조합 — <code>63</code> 전권 · <code>34</code> 조회·탐색만 ·
          <code>1</code> 생성만(올리기만, 못 봄) · <code>35</code> 생성·조회·탐색
        </p>
      </details>

      <details class="more">
        <summary>쓰는 템플릿은 셋뿐입니다</summary>
        <p>
          <code>/Mobius</code> 아래에 공용으로 두고 <code>acpi</code> 로 참조만 합니다.
          <strong>리소스마다 만들지 않습니다</strong> — ACP 개수를 한 자리로 유지하는 것이
          목표입니다.
        </p>
        <dl>
          <dt>A · 완전 비공개</dt>
          <dd>
            정해진 곳만 봅니다. <strong>장치 ID 를 적지 않아도 됩니다</strong> — 생성자는
            자동으로 통과하므로 장치는 자기가 만든 것을 계속 읽고 씁니다.
          </dd>
          <dt>B · 올리기는 열고, 보는 것만 제한</dt>
          <dd>
            <code>{{ '{"acor":["all"],"acop":1}' }}</code> 한 줄을 더합니다. 장비는 계속
            데이터를 올리고 조회·탐색만 팀으로 제한됩니다. “남이 못 보게”의 대부분이
            여기에 해당합니다.
          </dd>
          <dt>C · 보는 건 열고, 만드는 것만 막기</dt>
          <dd>
            <code>{{ '{"acor":["all"],"acop":34}' }}</code> 를 더합니다. 읽기는 지금처럼
            열되 아무나 넣지는 못하게 합니다.
          </dd>
        </dl>
        <p class="warn">
          <code>{{ '{"acor":["all"],"acop":35}' }}</code> 는 기본 정책과 같습니다 —
          그럴 거면 <strong>ACP 를 걸 이유가 없습니다.</strong>
        </p>
      </details>

      <details class="more">
        <summary>사고를 막는 규칙</summary>
        <ol class="rules">
          <li>
            <strong>생성자가 아닌 접근자만 <code>pv.acr</code> 에 적습니다.</strong>
            팀 AE·관리자처럼 <em>자기가 만들지 않은 것을 봐야 하는</em> 원본만 적으면
            됩니다. 장치 ID 는 몰라도 됩니다.
          </li>
          <li>
            <strong><code>pvs</code> 에 관리자를 반드시 넣습니다.</strong>
            <code>acp</code> 테이블에는 <code>cr</code> 컬럼이 <em>없어서</em>, 잘못 주면
            <strong>수퍼유저만</strong> 복구할 수 있습니다.
          </li>
          <li>
            <strong><code>acpi</code> 를 걸기 전에 그 ACP 가 실재하는지 확인합니다.</strong>
            ACP 를 먼저 만들고 응답의 <code>ri</code> 를 그대로 복사해 붙입니다.
          </li>
          <li>
            <strong>ACP 를 지우기 전에 참조를 먼저 풉니다.</strong> 지우면 그 리소스는
            생성자만 통과하는 상태가 됩니다. 상세 화면이 참조를 보여 줍니다.
          </li>
          <li>
            <strong><code>actw</code>(시간창)는 UTC 기준입니다.</strong> KST 09:00 은
            <code>0 0 0 * * *</code> 입니다. <code>초 분 시 일 월 요일</code> 6자리 정확히
            일치만 지원합니다.
          </li>
        </ol>
      </details>

      <details class="more">
        <summary>잠겼을 때 누가 풀 수 있나</summary>
        <table class="recover">
          <thead><tr><th>상황</th><th>풀 수 있는 주체</th></tr></thead>
          <tbody>
            <tr>
              <td>없는 ACP 를 가리켜 잠김</td>
              <td><strong>생성자</strong> 또는 수퍼유저</td>
            </tr>
            <tr>
              <td>정상 ACP 인데 <code>acr</code> 에 자기가 없음</td>
              <td><strong>생성자</strong>, <code>acr</code> 에 적힌 원본, 수퍼유저</td>
            </tr>
            <tr>
              <td><code>pvs</code> 를 잘못 줌</td>
              <td><strong>수퍼유저만</strong> (<code>acp</code> 에 <code>cr</code> 이 없음)</td>
            </tr>
          </tbody>
        </table>
        <p>
          푸는 방법은 셋 다 같습니다 — <code>PUT {{ '{"acpi":[]}' }}</code>.
          AE 의 생성자는 그 AE 의 <code>aei</code> 입니다.
        </p>
      </details>

      <p class="src">
        출처: <code>docs/superpowers/specs/2026-08-29-acp-operating-model.md</code>
        — 표의 수치는 전부 실측입니다.
      </p>
    </template>
  </div>
</template>

<style scoped>
.policy { margin: 0 0 1.6rem; max-width: 92ch; }

.principles {
  background: var(--accent-wash);
  border: 1px solid var(--accent);
  border-radius: 12px;
  padding: 1rem 1.2rem;
}
.principles h4 {
  margin: 0 0 0.5rem;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent-strong);
}
.principles ol { margin: 0; padding-left: 1.3rem; }
.principles li { font-size: 1.05rem; line-height: 1.7; color: var(--text-strong); }
.principles .tail { margin: 0.7rem 0 0; font-size: 0.95rem; color: var(--text); }

.alert {
  background: var(--danger-wash);
  border-left: 3px solid var(--danger);
  border-radius: 0 10px 10px 0;
  padding: 0.9rem 1.2rem;
  margin-top: 0.9rem;
}
.alert h4 { margin: 0 0 0.45rem; font-size: 1rem; color: var(--danger); }
.alert h4 em { font-style: normal; text-decoration: underline; }
.alert p { margin: 0 0 0.5rem; font-size: 0.95rem; }
.alert p:last-child { margin-bottom: 0; }

.more {
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0.6rem 0.9rem;
  margin-top: 0.6rem;
  background: var(--panel);
  font-size: 0.95rem;
}
.more summary { cursor: pointer; color: var(--text-strong); font-weight: 600; }
.more > p, .more > dl, .more > ol, .more > table { margin-top: 0.7rem; }
.more p { margin: 0 0 0.55rem; }
.more p.warn { color: var(--danger); }
.more dt { font-weight: 700; color: var(--text-strong); margin-top: 0.5rem; }
.more dd { margin: 0.15rem 0 0 0; padding-left: 0.9rem; border-left: 2px solid var(--border); }
.rules { padding-left: 1.2rem; }
.rules li { margin-bottom: 0.5rem; }

table.bits, table.recover { font-size: 0.93rem; border-collapse: collapse; }
table.bits td, table.bits th,
table.recover td, table.recover th {
  padding: 0.28rem 0.7rem;
  border-bottom: 1px solid var(--border-soft);
  text-align: left;
  position: static;
  text-transform: none;
  letter-spacing: 0;
  font-size: inherit;
  background: none;
  color: inherit;
}
table.bits th, table.recover th { color: var(--muted); font-weight: 600; }
.combos { color: var(--muted); }

.src { margin: 0.8rem 0 0; font-size: 0.85rem; color: var(--muted); }
</style>
