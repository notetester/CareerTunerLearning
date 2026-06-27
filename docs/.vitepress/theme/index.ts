import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import QuizBox from './components/QuizBox.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // 모든 마크다운에서 <QuizBox ... /> 사용 가능하도록 전역 등록
    app.component('QuizBox', QuizBox)
  },
} satisfies Theme
