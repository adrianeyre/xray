# Third-party notices

Xray is licensed under the [MIT License](LICENSE). It ships with, or depends on,
the third-party software listed below, which is distributed under its own
licence. Each notice is reproduced as its authors published it.

## ILSpy — `ICSharpCode.Decompiler` and the BAML decompiler

Xray's engine sidecar uses ILSpy's `ICSharpCode.Decompiler` for Decompilation,
and ILSpy's BAML decompiler to turn WPF BAML back into XAML.

- Source: <https://github.com/icsharpcode/ILSpy>
- Licence: MIT

```text
MIT license

Copyright (c) 2011-2025 AlphaSierraPapa for the ILSpy team

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## Mono.Cecil — `Mono.Cecil`

Xray's engine sidecar uses Mono.Cecil's managed reader of Windows PDBs to read
the local variable names and source files a Windows PDB beside an Assembly
records, on every OS.

- Source: <https://github.com/jbevain/cecil>
- Licence: MIT

```text
Copyright (c) 2008 - 2015 Jb Evain
Copyright (c) 2008 - 2011 Novell, Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Monaco Editor — `monaco-editor`

Xray's web UI shows the files of a Recovered Solution in the Monaco Editor,
bundled into the web app and served by `xray ui` itself. The components Monaco
in turn incorporates are listed, with their notices, in its own
`ThirdPartyNotices.txt`, which ships with the `monaco-editor` package.

- Source: <https://github.com/microsoft/monaco-editor>
- Licence: MIT

```text
The MIT License (MIT)

Copyright (c) 2016 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Node.js — in the downloads each release carries

The downloads attached to each GitHub release, for Windows, macOS and Linux,
hold the Node.js runtime Xray runs on, as the Node.js project publishes it at
<https://nodejs.org>. Its licence, with the notices of the software Node.js
itself includes, is beside it in each download, as `runtime/LICENSE`.

- Source: <https://github.com/nodejs/node>
- Licence: MIT, with the licences of its bundled dependencies

## IBM Plex Sans and JetBrains Mono — the project site's fonts

The project site serves these typefaces with it, rather than from any other
site. Each one's licence is beside it, in `packages/site/static/fonts/`.

- Source: <https://github.com/IBM/plex> and <https://github.com/JetBrains/JetBrainsMono>
- Licence: SIL Open Font License, Version 1.1
