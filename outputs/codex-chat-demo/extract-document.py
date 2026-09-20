"""Read uploaded documents without executing macros, links, or embedded files."""
import sys, zipfile, xml.etree.ElementTree as ET
path, ext = sys.argv[1:]
parts=[]
if ext == '.pdf':
    from pypdf import PdfReader
    reader=PdfReader(path)
    for page in reader.pages:
        parts.append(page.extract_text() or '')
        if sum(map(len,parts))>80000: break
else:
    with zipfile.ZipFile(path) as z:
        names=[n for n in z.namelist() if (ext=='.docx' and n=='word/document.xml') or (ext=='.pptx' and n.startswith('ppt/slides/slide') and n.endswith('.xml')) or (ext=='.xlsx' and (n=='xl/sharedStrings.xml' or n.startswith('xl/worksheets/sheet')) and n.endswith('.xml'))]
        if sum(z.getinfo(n).file_size for n in names)>20*1024*1024: raise ValueError('Document too large')
        shared=[]
        if ext=='.xlsx' and 'xl/sharedStrings.xml' in names:
            shared=[''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        for name in sorted(names):
            if name=='xl/sharedStrings.xml': continue
            tree=ET.fromstring(z.read(name))
            if ext=='.xlsx':
                for row in tree.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
                    cells=[]
                    for cell in row:
                        v=cell.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v'); value=v.text if v is not None else ''.join(cell.itertext())
                        if cell.get('t')=='s': value=shared[int(value)]
                        cells.append(value or '')
                    parts.append('\t'.join(cells))
            else:
                parts.extend(e.text or '' for e in tree.iter() if e.tag.endswith('}t'))
            if sum(map(len,parts))>80000: break
sys.stdout.buffer.write('\n'.join(parts).encode('utf-8'))
