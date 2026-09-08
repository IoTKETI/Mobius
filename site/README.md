# Mobius 가이드 사이트

GitHub Pages 로 배포하는 정적 사이트다. 빌드 도구가 없다 — 파일을 그대로 올린다.

```
site/
  index.html        랜딩 (언어 선택)
  ko/index.html     한국어 가이드
  en/index.html     English guide
  assets/ocean.css  ocean 테마 (밝은/어두운 화면 모두)
  assets/ocean.js   화면 전환 · 목차 따라가기 · 복사 버튼
  .nojekyll         Jekyll 을 돌리지 않는다는 표시
```

## 로컬에서 보기

```bash
npx --yes serve site      # 또는: python -m http.server 8000 -d site
```

파일을 직접 열어도(`file://`) 보이지만, 링크가 디렉터리(`ko/`)를 가리키므로
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

내용은 두 파일에 나뉘어 있고 **구조가 같다** — `ko/index.html` 의 절을 고쳤으면
`en/index.html` 의 같은 절도 고친다. 목차(`.toc`)의 항목과 본문 `id` 가 짝이므로
절을 더하면 양쪽 다 더한다.

수치(버전·포트·리소스 타입)는 저장소의 실제 값을 따른다. 코드가 바뀌면 여기도
같이 고친다.
