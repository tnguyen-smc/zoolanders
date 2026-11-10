/* Zoolanders · Tailwind theme (loaded right after the Tailwind CDN script) */
tailwind.config = {
    theme: { extend: {
      fontFamily: {
        display: ['Montserrat', 'system-ui', 'sans-serif'],
        sans: ['Montserrat', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
      },
      colors: {
        // slate + emerald come from CSS variables (see app.css)
        slate: Object.fromEntries([50,100,200,300,400,500,600,700,800,900,950].map(k => [k, `rgb(var(--sl-${k}) / <alpha-value>)`])),
        emerald: Object.fromEntries([50,100,200,300,400,500,600,700,800,900,950].map(k => [k, `rgb(var(--em-${k}) / <alpha-value>)`])),
        rose: { 50:'#fdf0f0',100:'#fadcdc',200:'#f4b8b9',300:'#ea8b8d',400:'#dc5a5e',500:'#c8323a',600:'#b02229',700:'#8f1a20',800:'#721519',900:'#5a1215',950:'#330a0c' }
      }
    } }
  };