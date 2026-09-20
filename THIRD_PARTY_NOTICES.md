# Third-party components

The MIT license at the repository root applies to this project's original code.
Dependencies retain their own copyright and license notices. Exact dependency
versions and transitive components are recorded in `package-lock.json`,
`src-tauri/Cargo.lock` and `collector/requirements-build.txt`.

Main components:

- [Tauri](https://github.com/tauri-apps/tauri): MIT or Apache-2.0.
- [React](https://github.com/facebook/react), [Radix UI](https://github.com/radix-ui/primitives),
  [Recharts](https://github.com/recharts/recharts), [Vite](https://github.com/vitejs/vite): MIT.
- [Lucide](https://github.com/lucide-icons/lucide): ISC; see its license for inherited icon notices.
- [psutil](https://github.com/giampaolo/psutil): BSD-3-Clause.
- [CPython](https://github.com/python/cpython): Python Software Foundation license;
  bundled components carry additional notices.
- [PyInstaller](https://github.com/pyinstaller/pyinstaller): GPL with a bootloader
  exception permitting bundled applications under other licenses.

The UI uses the Radix and class-variance-authority composition pattern demonstrated
by [shadcn/ui](https://github.com/shadcn-ui/ui). The following upstream notice is
included for that pattern and any derived portions:

MIT License

Copyright (c) 2023 shadcn

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
