import Editor from 'react-simple-code-editor';
import Prism from 'prismjs';
import 'prismjs/components/prism-python';
import 'prismjs/themes/prism.css';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: string;
}

export default function CodeEditor({ value, onChange, placeholder, minHeight = '120px' }: CodeEditorProps) {
  return (
    <div className="code-editor-wrapper" style={{ minHeight }}>
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={code => Prism.highlight(code, Prism.languages.python, 'python')}
        placeholder={placeholder}
        padding={8}
        style={{
          fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace",
          fontSize: '0.75rem',
          lineHeight: 1.5,
          minHeight,
        }}
      />
    </div>
  );
}
