# Mobius 가이드 사이트

GitHub Pages 로 배포하는 정적 사이트다. 빌드 도구가 없다 — 파일을 그대로 올린다.

```
site/
  index.html        한국어 가이드 (기본)
  en/index.html     English guide
  assets/ocean.css  ocean 테마 (밝은/어두운 화면 모두)
  assets/ocean.js   화면 전환 · 목차 따라가기 · 복사 버튼
  .nojekyll         Jekyll 을 돌리지 않는다는 표시
```

**언어 선택 화면은 두지 않는다.** 상단 바의 `한국어 / English` 가 그 일을 하므로
따로 고르는 페이지를 만들면 같은 선택이 두 번 나온다.

## 로컬에서 보기

```bash
npx --yes serve site      # 또는: python -m http.server 8000 -d site
```

파일을 직접 열어도(`file://`) 보이지만, 링크가 디렉터리(`en/`)를 가리키므로
서버로 띄우는 편이 실제와 같다.

## 배포

`gh-pages` 브랜치에 `site/` 의 **내용물**을 올린다. 저장소 관리자가 한 번
**Settings → Pages → Source: `gh-pages` / `(root)`** 로 지정하면 그 뒤로는 푸시만 하면 된다.

```bash
git subtree push --prefix site origin gh-pages
```

`git subtree` 는 site/ 만 잘라 gh-pages 로 올린다. 처음 한 번은 브랜치가 없으므로
같은 명령이 만들면서 올린다.

## 고칠 때

두 파일의 **절 구조와 `id` 가 같다.** 한쪽 절을 고쳤으면 반대쪽 같은 절도 고친다.
목차(`.toc`)의 항목과 본문 `id` 가 짝이므로 절을 더하면 양쪽 다 더한다.

수치(버전·포트·리소스 타입)는 저장소의 실제 값을 따른다. 코드가 바뀌면 여기도
같이 고친다.

## 로고

상단 바의 마크는 OCEAN 로고다. 옛 설치 가이드(v3.0.0)에 실려 있던 원본 이미지에서
형태와 색을 재어 인라인 SVG 로 다시 그렸다 — 광선 여덟, 바깥 반지름의 0.173배부터
시작하는 같은 굵기의 둥근 획. 파비콘도 같은 마크다. 색을 바꾸지 말 것.
