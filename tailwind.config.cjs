module.exports = {
  content: ['./index.html','./App.tsx','./components/**/*.{ts,tsx}','./services/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: { fontFamily: { sans:['Inter','Microsoft YaHei','system-ui','sans-serif'] }, colors: { brand:{50:'#e6fbf5',100:'#c0f5e6',200:'#96eed5',300:'#6ce7c4',400:'#42e0b3',500:'#20DBA3',600:'#1bc48f',700:'#17a77a',800:'#128a65',900:'#0d6d50'} } } },
  plugins: [],
};
