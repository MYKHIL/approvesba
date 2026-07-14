        import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
        import { initializeFirestore, collection, getDocs, doc, setDoc, getDoc, deleteDoc, updateDoc, deleteField, Timestamp, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

        // Global variables
        const SYSTEM_ACTIVATION_HASH = "c93a215026f36ac783bcac8ba5e4bbea1c3cdb6c79d3824f9712143c44dbb0f3";
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const isGitHubPages = window.location.hostname.includes('github.io');
        const isFileProtocol = window.location.protocol === 'file:' || !window.location.hostname;
        const API_BASE_URL = isLocal || isGitHubPages || isFileProtocol
            ? 'https://approvesba.vercel.app/api'
            : '/api';

        let FIREBASE_CONFIGS = {};
        let ACTIVATION_HASH = SYSTEM_ACTIVATION_HASH; // Use system constant
        const dbs = {};
        const apps = {};
        let schools = [];
        let selectedSchool = null;
        let selectedVariantId = null;
        let selectedTemplate = null;
        let currentActivationMode = 'online';
        let currentOnlineTab = 'summary';

        /**
         * Dynamic Bootstrap: Fetch configuration and initialize Firebase
         */
        async function loadBootstrapData() {
            if (window.showLoadingOverlay) window.showLoadingOverlay('Initializing Portal...', true);
            try {
                const response = await fetch(`${API_BASE_URL}/firebase-config`);
                if (!response.ok) throw new Error('Failed to load portal configuration');

                const data = await response.json();
                FIREBASE_CONFIGS = data.configs || {};
                ACTIVATION_HASH = data.activationHash || '';

                // Initialize Firestore instances dynamically
                Object.entries(FIREBASE_CONFIGS).forEach(([idx, config]) => {
                    const app = initializeApp(config, `db${idx}`);
                    apps[idx] = app;
                    dbs[idx] = initializeFirestore(app, {
                        experimentalForceLongPolling: true
                    });
                });

                console.log(`[Portal] Successfully initialized with ${Object.keys(dbs).length} databases.`);

                // If already logged in, fetch schools
                if (sessionStorage.getItem('portal_access') === 'true') {
                    await fetchAllSchools();
                }
            } catch (error) {
                console.error('[Bootstrap Error]', error);
                alert('CRITICAL: Failed to load portal configuration. Please check your connection or server status.');
            } finally {
                showLoadingOverlay('', false);
            }
        }

        // License Templates
        const LICENSE_TEMPLATES = [
            { name: 'Trial', maxStudents: 10, maxClass: 1, months: 0, days: 7, price: 'Free' },
            { name: 'Basic', maxStudents: 50, maxClass: 5, months: 12, price: 'GHS 200' },
            { name: 'Standard', maxStudents: 200, maxClass: 10, months: 12, price: 'GHS 500' },
            { name: 'Premium', maxStudents: 500, maxClass: 20, months: 12, price: 'GHS 1,000' },
            { name: 'Professional', maxStudents: 1000, maxClass: 50, months: 12, price: 'GHS 2,000' },
            { name: 'Enterprise', maxStudents: 5000, maxClass: 200, months: 12, price: 'GHS 5,000' },
            { name: 'Custom', maxStudents: 0, maxClass: 0, months: 12, price: 'Contact Sales' }
        ];



        async function hashPassword(password) {
            console.log('[Auth] Hashing password...');
            const encoder = new TextEncoder();
            const data = encoder.encode(password);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            console.log('[Auth] Generated Hash:', hashHex);
            return hashHex;
        }

        // Layer 1: Access
        window.loginPortal = async function () {
            const password = document.getElementById('portalPassword').value;
            if (!password) {
                alert('Please enter the portal password');
                return;
            }

            try {
                const hashedPassword = await hashPassword(password);
                console.log('[Auth] Sending Login Request to:', `${API_BASE_URL}/verify`);
                const response = await fetch(`${API_BASE_URL}/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: hashedPassword })
                });

                console.log('[Auth] Server Response Status:', response.status);

                if (!response.ok) {
                    const result = await response.json();
                    console.error('[Auth] Verification Failed:', response.status, result);
                    if (result.debug) {
                        console.log('[Auth] Debug Info:', result.debug);
                    }
                    alert(`Incorrect portal password. Error ${response.status}`);
                    return;
                }

                const result = await response.json();

                if (result.success) {
                    document.getElementById('loginGate').classList.add('hidden');
                    document.getElementById('mainContent').classList.remove('hidden');
                    document.getElementById('searchContainer').classList.remove('hidden');
                    sessionStorage.setItem('portal_access', 'true');
                    await fetchAllSchools();
                } else {
                    alert(result.message || 'Incorrect portal password');
                }
            } catch (error) {
                console.error('Login error:', error);
                alert('Failed to verify password. Please try again.');
            }
        }

        // Layer 2: Verification
        async function verifyMasterPassword() {
            const password = document.getElementById('activationPassword').value;
            if (!password) {
                showMessage('❌ Activation Master Password is required!', 'error');
                return false;
            }

            try {
                const hashedPassword = await hashPassword(password);
                const response = await fetch(`${API_BASE_URL}/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: hashedPassword })
                });

                const result = await response.json();
                if (!result.success) {
                    showMessage(`❌ ${result.message || 'Invalid Activation Master Password!'}`, 'error');
                    return false;
                }
                return true;
            } catch (error) {
                console.error('Verification error:', error);
                showMessage('❌ Verification failed. Please try again.', 'error');
                return false;
            }
        }

        const PAGE_SIZE = 10;
        let currentPage = 1;

        async function fetchAllSchools() {
            showLoadingOverlay('Fetching Schools...', true);
            schools = [];
            currentPage = 1;
            const schoolList = document.getElementById('schoolList');
            schoolList.innerHTML = '<div class="text-center text-gray-500 py-4">Loading schools...</div>';

            try {
                const promises = Object.entries(dbs).map(async ([dbIndex, db]) => {
                    const snapshot = await getDocs(collection(db, 'schools'));
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        schools.push({
                            id: doc.id,
                            name: data.settings?.schoolName || 'Unknown School',
                            baseName: doc.id.split('_')[0],
                            dbIndex: parseInt(dbIndex),
                            data: data,
                            access: data.Access
                        });
                    });
                });
                await Promise.all(promises);
                schools.sort((a, b) => a.name.localeCompare(b.name));
                renderSchools();
            } catch (error) {
                console.error('Fetch error:', error);
                showMessage('Failed to fetch schools', 'error');
            } finally {
                if (window.showLoadingOverlay) window.showLoadingOverlay('', false);
            }
        }

        function updateSchoolPagination(totalPages) {
            const pagination = document.getElementById('schoolPagination');
            if (!pagination) return;
            if (totalPages <= 1) {
                pagination.classList.add('hidden');
                return;
            }

            pagination.classList.remove('hidden');
            pagination.innerHTML = `
                <div>Page ${currentPage} of ${totalPages}</div>
                <div class="flex gap-2">
                    <button id="prevPageBtn" class="px-3 py-2 rounded-2xl bg-slate-900 text-slate-200 hover:bg-slate-800 transition-all" ${currentPage === 1 ? 'disabled' : ''}>Prev</button>
                    <button id="nextPageBtn" class="px-3 py-2 rounded-2xl bg-slate-900 text-slate-200 hover:bg-slate-800 transition-all" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
                </div>
            `;

            document.getElementById('prevPageBtn')?.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    renderSchools(document.getElementById('searchInput').value);
                }
            });
            document.getElementById('nextPageBtn')?.addEventListener('click', () => {
                if (currentPage < totalPages) {
                    currentPage++;
                    renderSchools(document.getElementById('searchInput').value);
                }
            });
        }

        function renderSchools(filter = '') {
            const schoolList = document.getElementById('schoolList');

            // GROUPING LOGIC
            const groups = {};
            schools.forEach(school => {
                if (filter && !school.name.toLowerCase().includes(filter.toLowerCase()) && !school.id.toLowerCase().includes(filter.toLowerCase())) {
                    return;
                }

                if (!groups[school.baseName]) {
                    groups[school.baseName] = {
                        ...school,
                        variants: 1,
                        anyPending: school.access === false
                    };
                } else {
                    groups[school.baseName].variants++;
                    if (school.access === false) groups[school.baseName].anyPending = true;
                }
            });

            const uniqueSchools = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
            const totalPages = Math.max(1, Math.ceil(uniqueSchools.length / PAGE_SIZE));
            if (currentPage > totalPages) currentPage = totalPages;

            if (uniqueSchools.length === 0) {
                schoolList.innerHTML = '<div class="text-center text-gray-500 py-8">No schools found</div>';
                document.getElementById('schoolPagination')?.classList.add('hidden');
                return;
            }

            const pagedSchools = uniqueSchools.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

            schoolList.innerHTML = pagedSchools.map(school => {
                const email = getEmailForDbIndex(school.dbIndex);
                const isSelected = selectedSchool?.baseName === school.baseName;
                return `
                <div class="p-4 border rounded-lg hover:bg-blue-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-100 border-blue-500 ring-2' : ''}"
                     onclick="selectSchool('${school.baseName}')">
                    <div class="flex justify-between items-start gap-3">
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2 mb-2">
                                <h3 class="font-semibold text-gray-900 truncate">${school.name}</h3>
                                ${isSelected ? '<span class="inline-flex items-center rounded-full bg-blue-600 text-white text-[10px] font-black uppercase tracking-[0.2em] px-2.5 py-1">OPEN</span>' : ''}
                            </div>
                            <p class="text-xs text-gray-500">ID: ${school.baseName} <span class="bg-gray-200 px-1 rounded text-[9px] ml-1">${school.variants} Variants</span></p>
                            <p class="text-xs text-slate-700 mt-1">Email: <span class="font-semibold text-slate-900">${email}</span></p>
                        </div>
                        <div class="flex flex-col items-end gap-1">
                            <span class="text-[10px] px-2 py-1 bg-gray-100 rounded text-gray-400">DB ${school.dbIndex}</span>
                            ${school.anyPending ? '<span class="text-[10px] px-2 py-1 bg-red-100 text-red-700 rounded font-bold">PENDING</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
            }).join('');

            updateSchoolPagination(totalPages);
        }

        function getEmailForDbIndex(dbIndex) {
            if (dbIndex === 1) return 'mykhilcreations@gmail.com';
            if (dbIndex === 2) return 'darkmic50@gmail.com';
            if (dbIndex >= 3) return `mykhilcreations${dbIndex - 2}@gmail.com`;
            return 'unknown@example.com';
        }

        function getVariantsForSchool(baseName) {
            return schools
                .filter(s => s.baseName === baseName)
                .sort((a, b) => a.id.localeCompare(b.id));
        }

        function getCurrentVariant() {
            if (!selectedSchool) return null;
            const variants = getVariantsForSchool(selectedSchool.baseName);
            if (!variants.length) return null;
            return variants.find(v => v.id === selectedVariantId) || variants[variants.length - 1];
        }

        window.selectSchool = async function (baseName) {
            const variants = getVariantsForSchool(baseName);
            if (!variants.length) return;

            selectedSchool = variants[variants.length - 1];
            selectedVariantId = selectedSchool.id;

            renderSchools(document.getElementById('searchInput').value);
            selectedSchool.existingExpiry = null; // Reset
            await loadSubscription(selectedSchool);
            updateUI();
            showActivationWorkspace();
            if (typeof window.switchMode === 'function') {
                window.switchMode('online');
            }
            if (typeof window.switchOnlineTab === 'function') {
                window.switchOnlineTab('summary');
            }

            if (window.matchMedia('(max-width: 1024px)').matches) {
                const rightPanel = document.getElementById('rightPanel');
                if (rightPanel) {
                    rightPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }

            await window.viewDatabaseSummary();
        }

        function showMessage(text, type = 'info', duration = 5000) {
            const container = document.getElementById('message');
            if (!container) {
                alert(text);
                return;
            }
            container.className = `mx-auto max-w-4xl mb-6 rounded-3xl p-4 text-sm font-bold ${
                type === 'success' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' :
                type === 'error' ? 'bg-red-50 text-red-900 border border-red-200' :
                type === 'warning' ? 'bg-amber-50 text-amber-900 border border-amber-200' :
                'bg-blue-50 text-blue-900 border border-blue-200'
            }`;
            container.textContent = text;
            container.classList.remove('hidden');
            if (duration > 0) {
                setTimeout(() => {
                    container.classList.add('hidden');
                }, duration);
            }
        }

        window.viewDatabaseSummary = async function () {
            if (!selectedSchool) return;
            const db = dbs[selectedSchool.dbIndex];
            const summaryPanel = document.getElementById('databaseSummaryPanel');
            summaryPanel.classList.remove('hidden');
            summaryPanel.innerHTML = '<div class="text-center text-gray-500 py-8">Loading summary...</div>';

            try {
                const schoolRef = doc(db, 'schools', selectedSchool.id);
                const [schoolSnap, studentSnap, classSnap, subjectSnap, assessmentSnap, gradeSnap, scoreBucketSnap, scoreSnap] = await Promise.all([
                    getDoc(schoolRef),
                    getDocs(collection(db, 'schools', selectedSchool.id, 'students')),
                    getDocs(collection(db, 'schools', selectedSchool.id, 'classes')),
                    getDocs(collection(db, 'schools', selectedSchool.id, 'subjects')),
                    getDocs(collection(db, 'schools', selectedSchool.id, 'assessments')),
                    getDocs(collection(db, 'schools', selectedSchool.id, 'grades')),
                    getDocs(collection(db, 'schools', selectedSchool.id, 'score_buckets')),
                    getDocs(collection(db, 'schools', selectedSchool.id, 'scores'))
                ]);

                const studentDocs = studentSnap.docs.map(doc => doc.data());
                const classDocs = classSnap.docs.map(doc => doc.data());
                const subjectDocs = subjectSnap.docs.map(doc => doc.data());
                const assessmentDocs = assessmentSnap.docs.map(doc => doc.data());
                const gradeDocs = gradeSnap.docs.map(doc => doc.data());

                const studentsPerClass = {};
                studentDocs.forEach(student => {
                    const cls = student.class || student.currentClass || 'Unassigned';
                    studentsPerClass[cls] = (studentsPerClass[cls] || 0) + 1;
                });

                const teachers = new Set();
                classDocs.forEach(cls => {
                    if (cls.teacherName) teachers.add(cls.teacherName.trim());
                    if (Array.isArray(cls.teacherNames)) cls.teacherNames.forEach(t => t && teachers.add(t.trim()));
                });

                const scoreCounts = {};
                scoreBucketSnap.docs.forEach(bucketDoc => {
                    const subjectId = bucketDoc.id.replace(/^subject_/, '');
                    const bucket = bucketDoc.data();
                    if (bucket && bucket.scoresMap) {
                        scoreCounts[subjectId] = Object.keys(bucket.scoresMap).length;
                    }
                });

                if (scoreSnap.size > 0) {
                    scoreSnap.docs.forEach(scoreDoc => {
                        const score = scoreDoc.data();
                        const subjectId = String(score.subjectId || 'unknown');
                        scoreCounts[subjectId] = (scoreCounts[subjectId] || 0) + 1;
                    });
                }

                const subjectSummary = subjectDocs.map(sub => ({
                    subjectId: String(sub.id || sub.subjectId || 'unknown'),
                    subjectName: sub.subject || sub.name || `Subject ${sub.id || 'N/A'}`,
                    count: scoreCounts[String(sub.id || sub.subjectId || 'unknown')] || 0
                }));

                summaryPanel.innerHTML = `
                    <div class="flex items-center justify-between gap-4 mb-4">
                        <div>
                            <h3 class="text-xl font-black text-gray-300">Database Summary</h3>
                            <p class="text-sm text-gray-500">${selectedSchool.id} in DB ${selectedSchool.dbIndex}</p>
                        </div>
                        <button onclick="document.getElementById('databaseSummaryPanel').classList.add('hidden')"
                            class="px-4 py-2 rounded-2xl bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all">Close</button>
                    </div>
                    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div class="p-4 bg-slate-50 rounded-3xl border border-slate-100">
                            <p class="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold mb-2">Students</p>
                            <p class="text-3xl font-black text-slate-900">${studentDocs.length}</p>
                            <p class="text-xs text-slate-500 mt-2">Total student records found in students collection.</p>
                        </div>
                        <div class="p-4 bg-slate-50 rounded-3xl border border-slate-100">
                            <p class="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold mb-2">Classes</p>
                            <p class="text-3xl font-black text-slate-900">${classDocs.length}</p>
                            <p class="text-xs text-slate-500 mt-2">Class documents loaded.</p>
                        </div>
                        <div class="p-4 bg-slate-50 rounded-3xl border border-slate-100">
                            <p class="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold mb-2">Teachers</p>
                            <p class="text-3xl font-black text-slate-900">${teachers.size}</p>
                            <p class="text-xs text-slate-500 mt-2">Unique teachers assigned to classes.</p>
                        </div>
                        <div class="p-4 bg-slate-50 rounded-3xl border border-slate-100">
                            <p class="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold mb-2">Subjects</p>
                            <p class="text-3xl font-black text-slate-900">${subjectDocs.length}</p>
                            <p class="text-xs text-slate-500 mt-2">Subjects configured for the school.</p>
                        </div>
                        <div class="p-4 bg-slate-50 rounded-3xl border border-slate-100">
                            <p class="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold mb-2">Assessments</p>
                            <p class="text-3xl font-black text-slate-900">${assessmentDocs.length}</p>
                            <p class="text-xs text-slate-500 mt-2">Assessment definitions present.</p>
                        </div>
                        <div class="p-4 bg-slate-50 rounded-3xl border border-slate-100">
                            <p class="text-xs uppercase tracking-[0.18em] text-slate-400 font-bold mb-2">Grades</p>
                            <p class="text-3xl font-black text-slate-900">${gradeDocs.length}</p>
                            <p class="text-xs text-slate-500 mt-2">Grade boundaries or definitions.</p>
                        </div>
                    </div>
                    <div class="mt-6 grid gap-4 lg:grid-cols-2">
                        <div class="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                            <h4 class="font-black text-slate-900 mb-3">Students per class</h4>
                            ${Object.keys(studentsPerClass).length === 0 ? '<p class="text-sm text-slate-500">No class assignments found.</p>' : `<div class="space-y-2">${Object.entries(studentsPerClass).sort((a,b)=>b[1]-a[1]).map(([cls,count]) => `<div class="flex justify-between gap-4"><span class="text-sm text-slate-700">${cls}</span><span class="font-black text-slate-900">${count}</span></div>`).join('')}</div>`}
                        </div>
                        <div class="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                            <h4 class="font-black text-slate-900 mb-3">Scores per subject</h4>
                            ${subjectSummary.length === 0 ? '<p class="text-sm text-slate-500">No subjects found.</p>' : `<div class="space-y-2">${subjectSummary.sort((a,b)=>b.count-a.count).map(subject => `<div class="flex justify-between gap-4"><span class="text-sm text-slate-700">${subject.subjectName}</span><span class="font-black text-slate-900">${subject.count}</span></div>`).join('')}</div>`}
                        </div>
                    </div>
                `;
            } catch (error) {
                console.error('Summary load failed', error);
                summaryPanel.innerHTML = '<div class="text-center text-red-500 py-8">Failed to load summary. Check console for details.</div>';
                showMessage('Failed to load database summary.', 'error');
            }
        }

        window.deleteDatabase = async function () {
            if (!selectedSchool) return;
            if (!(await verifyMasterPassword())) return;
            if (!confirm(`Delete ${selectedSchool.id} from DB ${selectedSchool.dbIndex}? This will remove the school document and its known subcollections.`)) return;

            showLoadingOverlay('Deleting database...', true);
            const db = dbs[selectedSchool.dbIndex];
            const subcollections = ['students', 'classes', 'subjects', 'assessments', 'grades', 'score_buckets', 'scores', 'attendance', 'reports', 'analytics', 'userLogs', 'activeSessions', 'config', 'metadata', 'terms'];
            try {
                for (const sub of subcollections) {
                    const snap = await getDocs(collection(db, 'schools', selectedSchool.id, sub));
                    if (!snap.empty) {
                        await Promise.all(snap.docs.map(docItem => deleteDoc(docItem.ref)));
                    }
                }
                await deleteDoc(doc(db, 'schools', selectedSchool.id));
                showMessage(`Deleted ${selectedSchool.id} from DB ${selectedSchool.dbIndex}.`, 'success');
                selectedSchool = null;
                await fetchAllSchools();
                updateUI();
            } catch (error) {
                console.error('Delete failed', error);
                showMessage('Failed to delete database. See console for details.', 'error');
            } finally {
                showLoadingOverlay('', false);
            }
        }

        window.loadSubscription = async function (school) {
            const baseName = school.id.split('_')[0];
            const db = dbs[school.dbIndex];
            const curExp = document.getElementById('currentExpiryDisplay');
            try {
                const subDoc = await getDoc(doc(db, 'subscriptions', baseName));
                if (subDoc.exists()) {
                    const data = subDoc.data();
                    document.getElementById('maxStudents').value = data.maxStudents || '';
                    document.getElementById('maxClass').value = data.maxClass || '';

                    if (data.expiryDate) {
                        // Calculate remaining time
                        const now = new Date();
                        const expDate = data.expiryDate.toDate();
                        school.existingExpiry = expDate;

                        const diffTime = expDate - now;
                        const isExpired = diffTime < 0;
                        const diffDays = Math.abs(Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

                        // Human readable duration
                        let remainingStr = '';
                        if (diffDays > 365) {
                            const y = Math.floor(diffDays / 365);
                            const d = diffDays % 365;
                            remainingStr = `${y} Year${y > 1 ? 's' : ''} ${d} Day${d !== 1 ? 's' : ''}`;
                        } else if (diffDays > 30) {
                            const m = Math.floor(diffDays / 30);
                            const d = diffDays % 30;
                            remainingStr = `${m} Month${m > 1 ? 's' : ''} ${d} Day${d !== 1 ? 's' : ''}`;
                        } else {
                            remainingStr = `${diffDays} Day${diffDays !== 1 ? 's' : ''}`;
                        }

                        const statusColor = isExpired ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200';
                        const statusIcon = isExpired ? '<path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke-width="2" stroke-linecap="round"/>' : '<path d="M12 8v4l3 3" stroke-width="2" stroke-linecap="round"/>';

                        curExp.innerHTML = `
                            <div class="p-3 ${statusColor} border rounded-lg text-xs font-bold flex items-center gap-2">
                                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">${statusIcon}</svg>
                                <div>
                                    <p class="uppercase tracking-wider text-[10px] opacity-75">${isExpired ? 'Expired' : 'Active Subscription'}</p>
                                    <p class="text-sm">${isExpired ? 'Expired ago: ' : 'Remaining: '} ${remainingStr}</p>
                                    <p class="text-[10px] opacity-75 mt-1">Existing Expiry Date: ${expDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                                </div>
                            </div>`;
                        curExp.classList.remove('hidden');
                    } else {
                        curExp.classList.add('hidden');
                    }
                } else {
                    curExp.classList.add('hidden');
                    // AUTO-SELECT TRIAL FOR NEW SCHOOLS
                    applyTemplate(0);
                }
            } catch (e) {
                console.error("Load sub failed", e);
                curExp.classList.add('hidden');
            }
            // Ensure inputs are refreshed
            updateExpectedExpiry();
        }

        function updateUI() {
            const el = document.getElementById('selectedSchool');
            const form = document.getElementById('licenseForm');
            const migrate = document.getElementById('migrationPanel');
            const targetSelect = document.getElementById('targetDbSelect');
            const summaryPanel = document.getElementById('databaseSummaryPanel');
            if (!selectedSchool && summaryPanel) summaryPanel.classList.add('hidden');

            if (selectedSchool) {
                showActivationWorkspace();
                el.innerHTML = `
                    <div class="bg-blue-50 p-4 rounded-xl border border-blue-200">
                        <p class="text-xs text-blue-600 font-bold uppercase mb-1">Target School</p>
                        <p class="font-bold text-lg text-gray-900">${selectedSchool.name}</p>
                        <p class="text-xs text-gray-500">Source DB: ${selectedSchool.dbIndex} | ID: ${selectedSchool.id}</p>
                    </div>
                    <div class="mt-6 grid gap-3 sm:grid-cols-2">
                        <button id="viewSummaryBtn"
                            class="w-full py-3 px-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all">
                            Refresh Summary
                        </button>
                        <button id="deleteDatabaseBtn"
                            class="w-full py-3 px-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all">
                            Delete Database
                        </button>
                    </div>
                    ${getVariantsForSchool(selectedSchool.baseName).length > 1 ? `
                        <div class="mt-4">
                            <label for="summaryVariantSelect" class="block text-xs font-black uppercase text-gray-400 mb-2">Variant</label>
                            <select id="summaryVariantSelect" class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400">
                                ${getVariantsForSchool(selectedSchool.baseName).map(variant => `
                                    <option value="${variant.id}" ${variant.id === selectedVariantId ? 'selected' : ''}>${variant.name} (${variant.id})</option>
                                `).join('')}
                            </select>
                        </div>
                    ` : ''}`;
                form.classList.remove('hidden');

                const summaryBtn = document.getElementById('viewSummaryBtn');
                if (summaryBtn) {
                    summaryBtn.addEventListener('click', async (event) => {
                        event.preventDefault();
                        if (typeof window.viewDatabaseSummary === 'function') {
                            await window.viewDatabaseSummary();
                        }
                    });
                }
                const deleteBtn = document.getElementById('deleteDatabaseBtn');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', async (event) => {
                        event.preventDefault();
                        if (typeof window.deleteDatabase === 'function') {
                            await window.deleteDatabase();
                        }
                    });
                }

                const variantSelect = document.getElementById('summaryVariantSelect');
                if (variantSelect) {
                    variantSelect.addEventListener('change', async (event) => {
                        const target = event.target;
                        if (!(target instanceof HTMLSelectElement)) return;
                        selectedVariantId = target.value;
                        await window.viewDatabaseSummary();
                    });
                }

                const targetSelect = document.getElementById('targetDbSelect');
                const passwordContainer = document.getElementById('passwordContainer');
                const sourceVariantSelect = document.getElementById('granularSourceVariant');
                const targetDbSelect = document.getElementById('granularTargetDb');
                const granularMigrationPanel = document.getElementById('granularMigrationPanel');

                migrate.classList.remove('hidden');
                if (passwordContainer) passwordContainer.classList.remove('hidden');

                if (targetSelect) {
                    targetSelect.innerHTML = '<option value="">Select Destination...</option>' +
                        Object.keys(dbs).filter(idx => parseInt(idx) !== selectedSchool.dbIndex)
                            .map(idx => {
                                const config = FIREBASE_CONFIGS[idx] || {};
                                const comment = config.comment ? ` - ${config.comment}` : '';
                                return `<option value="${idx}">Database ${idx} (${config.projectId || 'unknown'}${comment})</option>`;
                            })
                            .join('');
                }

                if (sourceVariantSelect) {
                    const sourceVariants = schools.filter(s => s.baseName === selectedSchool.baseName && s.dbIndex === selectedSchool.dbIndex);
                    sourceVariantSelect.innerHTML = sourceVariants.map(v => `<option value="${v.id}">${v.name} (${v.id})</option>`).join('');
                }

                if (targetDbSelect) {
                    targetDbSelect.innerHTML = '<option value="">Select Target DB...</option>' +
                        Object.keys(dbs).map(idx => {
                            const config = FIREBASE_CONFIGS[idx] || {};
                            const comment = config.comment ? ` - ${config.comment}` : '';
                            return `<option value="${idx}">Database ${idx}${idx == selectedSchool.dbIndex ? ' (Current)' : ''}${comment}</option>`;
                        }).join('');
                }

                if (granularMigrationPanel) granularMigrationPanel.classList.remove('hidden');

            } else {
                el.innerHTML = '<p class="text-gray-400 text-center py-4 italic">Select a school from the left to begin</p>';
                form.classList.add('hidden');
                migrate.classList.add('hidden');
                document.getElementById('granularMigrationPanel').classList.add('hidden');
                document.getElementById('passwordContainer').classList.add('hidden');

                const rightPanel = document.getElementById('rightPanel');
                if (rightPanel) {
                    rightPanel.classList.add('hidden');
                }
                const schoolPanel = document.getElementById('schoolPanel');
                if (schoolPanel) {
                    schoolPanel.classList.remove('lg:col-span-5');
                    schoolPanel.classList.add('lg:col-span-12');
                }
            }
        }

        window.showActivationWorkspace = function () {
            const rightPanel = document.getElementById('rightPanel');
            const schoolPanel = document.getElementById('schoolPanel');
            const pagination = document.getElementById('schoolPagination');
            const searchContainer = document.getElementById('searchContainer');
            const backBtn = document.getElementById('backToSchoolsBtn');

            if (rightPanel) {
                rightPanel.style.display = 'block';
                rightPanel.classList.remove('lg:col-span-7');
                rightPanel.classList.add('lg:col-span-12');
            }
            if (schoolPanel) {
                schoolPanel.style.display = 'none';
                schoolPanel.classList.add('hidden');
            }
            if (pagination) {
                pagination.style.display = 'none';
                pagination.classList.add('hidden');
            }
            if (searchContainer) {
                searchContainer.style.display = 'none';
                searchContainer.classList.add('hidden');
            }
            if (backBtn) {
                backBtn.classList.remove('hidden');
            }
            const inner = document.getElementById('rightPanelInner');
            if (inner) {
                inner.classList.add('flip-in');
                setTimeout(() => inner.classList.remove('flip-in'), 700);
            }
            const onlinePanel = document.getElementById('onlinePanel');
            if (onlinePanel) {
                onlinePanel.classList.remove('hidden');
            }
            const onlineNav = document.getElementById('onlineTabNav');
            if (onlineNav) {
                onlineNav.classList.remove('hidden');
            }
            const onlineContent = document.getElementById('onlineTabContent');
            if (onlineContent) {
                onlineContent.classList.remove('hidden');
            }
        }

        window.goBackToSchoolList = function () {
            const rightPanel = document.getElementById('rightPanel');
            const schoolPanel = document.getElementById('schoolPanel');
            const pagination = document.getElementById('schoolPagination');
            const searchContainer = document.getElementById('searchContainer');
            const backBtn = document.getElementById('backToSchoolsBtn');

            if (rightPanel) {
                rightPanel.style.display = 'none';
                rightPanel.classList.remove('lg:col-span-12');
                rightPanel.classList.add('lg:col-span-7');
            }
            if (schoolPanel) {
                schoolPanel.style.display = '';
                schoolPanel.classList.remove('hidden');
                schoolPanel.classList.remove('lg:col-span-5');
                schoolPanel.classList.add('lg:col-span-12');
            }
            if (pagination) {
                pagination.style.display = '';
                pagination.classList.remove('hidden');
            }
            if (searchContainer) {
                searchContainer.style.display = '';
                searchContainer.classList.remove('hidden');
            }
            if (backBtn) {
                backBtn.classList.add('hidden');
            }
        }

        window.switchOnlineTab = function (tab) {
            currentOnlineTab = tab;
            const tabs = ['summary', 'license', 'migration', 'transfer'];
            tabs.forEach(section => {
                const button = document.getElementById(`tab${section.charAt(0).toUpperCase() + section.slice(1)}Btn`);
                const panel = document.getElementById(`tab${section.charAt(0).toUpperCase() + section.slice(1)}`);
                const active = section === tab;
                if (button) {
                    button.classList.toggle('bg-blue-600', active);
                    button.classList.toggle('text-white', active);
                    button.classList.toggle('bg-slate-900', !active);
                    button.classList.toggle('text-slate-200', !active);
                }
                if (panel) {
                    panel.classList.toggle('hidden', !active);
                }
            });
        }

        window.updateExpectedExpiry = function () {
            const val = parseInt(document.getElementById('durationValue').value) || 0;
            const unit = document.getElementById('durationUnit').value;
            const exp = document.getElementById('expectedExpiryDisplay');

            if (val === 0) { exp.classList.add('hidden'); return; }

            // Calculate from TODAY
            const date = new Date();

            // Add Duration based on Unit
            if (unit === 'days') date.setDate(date.getDate() + val);
            else if (unit === 'weeks') date.setDate(date.getDate() + (val * 7));
            else if (unit === 'months') date.setMonth(date.getMonth() + val);
            else if (unit === 'years') date.setFullYear(date.getFullYear() + val);

            exp.innerHTML = `
                <div class="p-2 bg-green-50 border border-green-200 rounded-lg text-xs font-bold text-green-700 flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14" stroke-width="2" stroke-linecap="round"/></svg>
                    Expected Expiry: ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>`;
            exp.classList.remove('hidden');
        }

        window.applyTemplate = function (idx) {
            const t = LICENSE_TEMPLATES[idx];
            document.getElementById('maxStudents').value = t.maxStudents;
            document.getElementById('maxClass').value = t.maxClass;

            // Auto-fill Unit & Value based on template type
            if (t.name === 'Trial') {
                document.getElementById('durationValue').value = 1;
                document.getElementById('durationUnit').value = 'weeks';
            } else {
                // Paid Plans default to 1 Year
                document.getElementById('durationValue').value = 1;
                document.getElementById('durationUnit').value = 'years';
            }

            updateExpectedExpiry();
            document.querySelectorAll('[data-template]').forEach(el => el.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50'));
            document.querySelector(`[data-template="${idx}"]`).classList.add('ring-2', 'ring-blue-500', 'bg-blue-50');
        }

        window.quickActivate = async function (idx) {
            const t = LICENSE_TEMPLATES[idx];
            if (!selectedSchool || !(await verifyMasterPassword())) return;

            let addTime = false;
            const now = new Date();
            if (selectedSchool.existingExpiry && selectedSchool.existingExpiry > now) {
                addTime = confirm(`This school has an active subscription until ${selectedSchool.existingExpiry.toLocaleDateString()}.\n\nWould you like to ADD the new ${t.name} duration to the existing time?\n\n- Click OK (Yes) to add up.\n- Click Cancel (No) to start fresh from today.`);
            }

            const msg = `Quick Activate ${t.name} for ${selectedSchool.name} (All Variations)?\n\nStudents: ${t.maxStudents}\nClasses: ${t.maxClass}\nDuration: ${t.months}mo\nMode: ${addTime ? 'ACCUMULATE' : 'RESTART'}`;
            if (!confirm(msg)) return;

            showLoadingOverlay('Activating...', true);
            try {
                const baseDate = (addTime && selectedSchool.existingExpiry) ? selectedSchool.existingExpiry : new Date();
                const expiryDate = new Date(baseDate.getTime());

                if (t.months) expiryDate.setMonth(baseDate.getMonth() + t.months);
                else expiryDate.setDate(baseDate.getDate() + (t.days || 7));

                const sub = {
                    maxStudents: t.maxStudents,
                    maxClass: t.maxClass,
                    expiryDate: Timestamp.fromDate(expiryDate),
                    activationHash: SYSTEM_ACTIVATION_HASH,
                    lastActivated: Timestamp.now()
                };

                // Write Subscription (One per base name)
                console.log(`[Firestore] Writing Subscription for ${selectedSchool.baseName}:`, sub);
                await setDoc(doc(dbs[selectedSchool.dbIndex], 'subscriptions', selectedSchool.baseName), sub);

                // BATCH UPDATE ACCESS FOR ALL VARIANTS
                const variants = schools.filter(s => s.baseName === selectedSchool.baseName);
                const updates = variants.map(variant => {
                    const schoolRef = doc(dbs[variant.dbIndex], 'schools', variant.id);
                    const payload = {
                        Access: true,
                        activationHash: SYSTEM_ACTIVATION_HASH
                    };
                    console.log(`[Firestore] Updating School ${variant.id} (Access: true):`, payload);
                    return setDoc(schoolRef, payload, { merge: true });
                });

                await Promise.all(updates);
                console.log(`[Batch Update] Granted access to ${variants.length} content variants for ${selectedSchool.baseName}`);

                alert(`✅ ${t.name} activated & Access Granted for ${variants.length} variants!`);

                // Update local model to reflect change immediately without refresh
                variants.forEach(v => v.access = true);
                renderSchools(document.getElementById('searchInput').value);

                resetPortal();
            } catch (e) {
                console.error(e);
                showMessage('❌ Activation failed', 'error');
            } finally {
                showLoadingOverlay('', false);
            }
        }

        window.migrateSchool = async function () {
            if (!selectedSchool || !(await verifyMasterPassword())) return;
            const targetDbIndex = parseInt(document.getElementById('targetDbSelect').value);
            if (!targetDbIndex || targetDbIndex === selectedSchool.dbIndex) {
                alert('Please select a different target database.');
                return;
            }

            const baseName = selectedSchool.baseName;
            const sourceDb = dbs[selectedSchool.dbIndex];
            const targetDb = dbs[targetDbIndex];

            const msg = `MIGRATE all data for "${baseName}" from DB ${selectedSchool.dbIndex} to DB ${targetDbIndex}?\n\nThis will copy:\n- All school variants (years/terms)\n- All students and classes\n- Subscription data\n\nExisting data in the target database for this school will be OVERWRITTEN.`;
            if (!confirm(msg)) return;

            showLoadingOverlay('Starting Migration...', true);
            try {
                console.log(`[Migration] STARTING for ${baseName} from DB ${selectedSchool.dbIndex} to DB ${targetDbIndex}`);

                // 1. Fetch & Write Subscription
                showLoadingOverlay(`Migrating Subscription: ${baseName}...`, true);
                const subDoc = await getDoc(doc(sourceDb, 'subscriptions', baseName));
                if (subDoc.exists()) {
                    const subData = { ...subDoc.data(), activationHash: SYSTEM_ACTIVATION_HASH };
                    console.log(`[Migration] Writing Subscription to Target DB:`, subData);
                    await setDoc(doc(targetDb, 'subscriptions', baseName), subData);

                    // Delay to allow indexing/propagation for security rules
                    console.log(`[Migration] Waiting for subscription propagation (1s)...`);
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    console.warn(`[Migration] No subscription found for ${baseName}. Migration might fail due to security rules.`);
                }

                // 2. Fetch all variants from CURRENT source list
                // 3. Migrate Variants
                const variants = schools.filter(s => s.baseName === baseName && s.dbIndex === selectedSchool.dbIndex);
                console.log(`[Migration] Found ${variants.length} content variants to move.`);
                let count = 0;

                // Diagnostics for progress
                let completedUnits = 0;
                const OTHER_SUBCOLS = ['attendance', 'reports', 'analytics', 'userLogs', 'activeSessions', 'metadata', 'terms', 'config', 'settings'];
                const unitsPerVariant = 1 /*main school doc*/ + 1 /*metadata bundle*/ + 1 /*students*/ + 1 /*scores*/ + OTHER_SUBCOLS.length;
                const totalUnits = (variants.length * unitsPerVariant) + 1 /*subscription*/;

                const updateMigrateProgress = (msg) => {
                    const percent = Math.round((completedUnits / totalUnits) * 100);
                    showLoadingOverlay(`${msg} (${percent}%)`, true);
                };

                // Increment for subscription already done
                completedUnits++;

                for (const variant of variants) {
                    count++;
                    console.log(`[Migration] Processing Variant ${count}/${variants.length}: ${variant.id}`);
                    updateMigrateProgress(`Migrating ${variant.id}...`);

                    // A. Migrate School Document
                    const schoolData = {
                        ...variant.data,
                        migratedFrom: selectedSchool.dbIndex,
                        activationHash: SYSTEM_ACTIVATION_HASH,
                        Access: true
                    };
                    await setDoc(doc(targetDb, 'schools', variant.id), schoolData);
                    completedUnits++;
                    updateMigrateProgress(`Writing ${variant.id}...`);

                    // B. BUCKETIZED MIGRATION

                    // 1. Metadata Bundle
                    try {
                        const [classes, subjects, assessments] = await Promise.all([
                            getDocs(collection(sourceDb, 'schools', variant.id, 'classes')),
                            getDocs(collection(sourceDb, 'schools', variant.id, 'subjects')),
                            getDocs(collection(sourceDb, 'schools', variant.id, 'assessments'))
                        ]);
                        const bundle = {
                            classes: classes.docs.map(d => d.data()),
                            subjects: subjects.docs.map(d => d.data()),
                            assessments: assessments.docs.map(d => d.data()),
                            lastUpdated: Timestamp.now()
                        };
                        await setDoc(doc(targetDb, 'schools', variant.id, 'config', 'metadata_bundle'), bundle);
                    } catch (e) { console.error(`[Migration] Bundle failed:`, e); }
                    completedUnits++;
                    updateMigrateProgress(`Bundling metadata...`);

                    // 2. Student Bucketing
                    try {
                        const studentSnap = await getDocs(collection(sourceDb, 'schools', variant.id, 'students'));
                        const students = studentSnap.docs.map(d => d.data());
                        if (students.length > 0) {
                            const CHUNK_SIZE = 10000;
                            const totalChunks = Math.ceil(students.length / CHUNK_SIZE);
                            await setDoc(doc(targetDb, 'schools', variant.id, 'config', 'student_bucket_manifest'), {
                                totalChunks, totalStudents: students.length, chunkSize: CHUNK_SIZE, lastUpdated: Timestamp.now()
                            });
                            for (let i = 0; i < totalChunks; i++) {
                                await setDoc(doc(targetDb, 'schools', variant.id, 'config', `student_bucket_${i}`), { students: students.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
                            }
                        }
                    } catch (e) { console.error(`[Migration] Students failed:`, e); }
                    completedUnits++;
                    updateMigrateProgress(`Bucketing students...`);

                    // 3. Score Bucketing
                    try {
                        const existingBuckets = await getDocs(collection(sourceDb, 'schools', variant.id, 'score_buckets'));
                        if (!existingBuckets.empty) {
                            for (const b of existingBuckets.docs) await setDoc(doc(targetDb, 'schools', variant.id, 'score_buckets', b.id), b.data());
                        }
                        const scoreSnap = await getDocs(collection(sourceDb, 'schools', variant.id, 'scores'));
                        if (!scoreSnap.empty) {
                            const scores = scoreSnap.docs.map(d => d.data());
                            const subjectBuckets = {};
                            scores.forEach(s => {
                                if (!subjectBuckets[s.subjectId]) subjectBuckets[s.subjectId] = {};
                                subjectBuckets[s.subjectId][s.id] = s;
                            });
                            for (const [subId, map] of Object.entries(subjectBuckets)) {
                                await setDoc(doc(targetDb, 'schools', variant.id, 'score_buckets', `subject_${subId}`), { scoresMap: map }, { merge: true });
                            }
                        }
                    } catch (e) { console.error(`[Migration] Scores failed:`, e); }
                    completedUnits++;
                    updateMigrateProgress(`Bucketing scores...`);

                    // C. General Subcollections
                    for (const sub of OTHER_SUBCOLS) {
                        try {
                            const snapshot = await getDocs(collection(sourceDb, 'schools', variant.id, sub));
                            if (!snapshot.empty) {
                                for (const d of snapshot.docs) {
                                    if (sub === 'config' && (d.id.startsWith('student_bucket_') || d.id === 'student_bucket_manifest' || d.id === 'metadata_bundle')) continue;
                                    await setDoc(doc(targetDb, 'schools', variant.id, sub, d.id), d.data());
                                }
                            }
                        } catch (subErr) { console.error(`[Migration] ${sub} failed:`, subErr); }
                        completedUnits++;
                        updateMigrateProgress(`Moving ${sub}...`);
                    }
                }

                alert(`✅ Migration Complete!\n\n${variants.length} school variants moved to DB ${targetDbIndex}.\n\nIMPORTANT: Remember to update the SCHOOL_DATABASE_MAPPING in Vercel to point "${baseName}" to Database ${targetDbIndex}.`);

                // Cleanup Option
                if (confirm(`Do you want to DELETE "${baseName}" from the SOURCE Database ${selectedSchool.dbIndex} now?\n\nOnly do this if you have verified the migration and updated the Vercel mapping.`)) {
                    showLoadingOverlay(`Starting Cleanup (0%)...`, true);
                    console.log(`[Migration] CLEANUP: Starting removal from Source DB ${selectedSchool.dbIndex}`);

                    const subcollections = [
                        'students', 'classes', 'subjects', 'assessments',
                        'score_buckets', 'scores', 'attendance', 'reports',
                        'analytics', 'userLogs', 'activeSessions', 'metadata',
                        'terms', 'config', 'settings'
                    ];

                    // 1. Diagnostics & Pre-fetch
                    const failedDeletes = [];
                    let totalOps = 1; // 1 for the subscription itself
                    let completedOps = 0;

                    const updateProgress = (msg) => {
                        const percent = Math.round((completedOps / totalOps) * 100);
                        showLoadingOverlay(`${msg} (${percent}%)`, true);
                    };

                    // Calculate total documents for progress tracking
                    showLoadingOverlay('Calculating cleanup size...', true);
                    for (const variant of variants) {
                        totalOps += 1; // For the school document itself
                        for (const sub of subcollections) {
                            try {
                                const snap = await getDocs(collection(sourceDb, 'schools', variant.id, sub));
                                totalOps += snap.size;
                            } catch (e) {
                                console.warn(`[Migration] Could not calculate size for ${sub} in ${variant.id}`);
                            }
                        }
                    }
                    console.log(`[Migration] Total Deletion Operations: ${totalOps}`);

                    // 2. DELETE ALL SUBCOLLECTIONS ACROSS ALL VARIANTS
                    for (const variant of variants) {
                        console.log(`[Migration] Step 2: Deleting subcollections for ${variant.id}`);
                        for (const sub of subcollections) {
                            try {
                                const snapshot = await getDocs(collection(sourceDb, 'schools', variant.id, sub));
                                if (!snapshot.empty) {
                                    console.log(`[Migration] DELETING ${snapshot.size} docs from ${sub}...`);
                                    for (const d of snapshot.docs) {
                                        try {
                                            await deleteDoc(doc(sourceDb, 'schools', variant.id, sub, d.id));
                                            completedOps++;
                                            updateProgress(`Deleting ${sub}...`);
                                        } catch (err) {
                                            failedDeletes.push(`${variant.id}/${sub}/${d.id}`);
                                            console.error(`[Migration] Delete Failed: ${variant.id}/${sub}/${d.id}`);
                                        }
                                    }
                                }
                            } catch (delErr) {
                                console.warn(`[Migration] Access error reading subcollection ${sub} for deletion.`);
                            }
                        }
                    }

                    // 3. DELETE ALL MAIN SCHOOL DOCUMENTS
                    for (const variant of variants) {
                        console.log(`[Migration] Step 3: Deleting school document ${variant.id}`);
                        try {
                            await deleteDoc(doc(sourceDb, 'schools', variant.id));
                            completedOps++;
                            updateProgress(`Deleting variants...`);
                        } catch (err) {
                            failedDeletes.push(`schools/${variant.id}`);
                        }
                    }

                    // 4. DELETE SUBSCRIPTION DOCUMENT LAST
                    console.log(`[Migration] Step 4: Deleting subscription ${baseName}`);
                    try {
                        await deleteDoc(doc(sourceDb, 'subscriptions', baseName));
                        completedOps++;
                        updateProgress(`Finalizing...`);
                    } catch (err) {
                        failedDeletes.push(`subscriptions/${baseName}`);
                    }

                    if (failedDeletes.length > 0) {
                        const ghostList = failedDeletes.join('\n- ');
                        alert(`⚠️ Cleanup partially complete (${Math.round((completedOps / totalOps) * 100)}%).\n\nThe following "Ghost Documents" could not be deleted and require manual removal in Firebase Console:\n\n- ${ghostList}\n\nThis usually happens if the subscription expired during cleanup.`);
                    } else {
                        alert('✅ Migration Cleanup Complete! All source data removed.');
                    }
                }

                // Refresh to show changes
                await fetchAllSchools();
                resetPortal();
            } catch (e) {
                console.error('Migration failed:', e);
                alert(`❌ Migration failed: ${e.message}`);
            } finally {
                showLoadingOverlay('', false);
            }
        }

        window.fetchTargetVariants = async function (targetDbIndex) {
            if (!targetDbIndex) return;
            const targetDb = dbs[targetDbIndex];
            const variantSelect = document.getElementById('granularTargetVariant');
            variantSelect.innerHTML = '<option value="">Loading variants...</option>';

            try {
                const snapshot = await getDocs(collection(targetDb, 'schools'));
                const targetSchools = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    targetSchools.push({
                        id: doc.id,
                        name: data.settings?.schoolName || 'Unknown School',
                    });
                });
                targetSchools.sort((a, b) => a.name.localeCompare(b.name));

                variantSelect.innerHTML = '<option value="">Select Target Variant...</option>' +
                    targetSchools.map(s => `<option value="${s.id}">${s.name} (${s.id})</option>`).join('');
            } catch (e) {
                console.error('Fetch target variants failed:', e);
                variantSelect.innerHTML = '<option value="">Error loading variants</option>';
            }
        }

        // Helper to rebuild student buckets in target
        async function rebuildStudentBucket(targetDb, variantId, students) {
            if (!students || students.length === 0) return;
            const chunkSize = 10000;
            const totalChunks = Math.ceil(students.length / chunkSize);

            // 1. Write Manifest
            const manifestRef = doc(targetDb, "schools", variantId, "config", "student_bucket_manifest");
            await setDoc(manifestRef, {
                totalChunks,
                totalStudents: students.length,
                lastUpdated: serverTimestamp(),
                chunkSize
            });

            // 2. Write Chunks
            for (let i = 0; i < totalChunks; i++) {
                const chunk = students.slice(i * chunkSize, (i + 1) * chunkSize);
                const chunkRef = doc(targetDb, "schools", variantId, "config", `student_bucket_${i}`);
                await setDoc(chunkRef, { students: chunk });
            }
            console.log(`[Granular] Rebuilt student bucket (${totalChunks} chunks) for ${variantId}`);
        }

        // Helper to rebuild metadata bundle in target
        async function rebuildMetadataBundle(targetDb, variantId, data) {
            const bundleRef = doc(targetDb, "schools", variantId, "config", "metadata_bundle");
            const bundleData = {
                ...data,
                lastUpdated: serverTimestamp()
            };
            await setDoc(bundleRef, bundleData, { merge: true });
            console.log(`[Granular] Rebuilt metadata bundle for ${variantId}`);
        }

        window.runGranularMigration = async function (operation = 'copy') {
            if (!selectedSchool || !(await verifyMasterPassword())) return;

            const sourceVariantId = document.getElementById('granularSourceVariant').value;
            const targetDbIndex = parseInt(document.getElementById('granularTargetDb').value);
            const targetVariantId = document.getElementById('granularTargetVariant').value;

            if (!sourceVariantId || !targetDbIndex || !targetVariantId) {
                alert('Please select source variant, target database, and target variant.');
                return;
            }

            const collectionsToTransfer = [];
            const selectedItems = {
                assessments: document.getElementById('checkAssessments').checked,
                classes: document.getElementById('checkClasses').checked,
                students: document.getElementById('checkStudents').checked,
                subjects: document.getElementById('checkSubjects').checked,
                scores: document.getElementById('checkScores').checked,
                score_buckets: document.getElementById('checkScoreBuckets').checked,
                config: document.getElementById('checkConfig').checked,
                users: document.getElementById('checkUsers').checked
            };

            if (selectedItems.assessments) collectionsToTransfer.push('assessments');
            if (selectedItems.classes) collectionsToTransfer.push('classes');
            if (selectedItems.students) collectionsToTransfer.push('students');
            if (selectedItems.subjects) collectionsToTransfer.push('subjects');
            if (selectedItems.scores) collectionsToTransfer.push('scores');
            if (selectedItems.score_buckets) collectionsToTransfer.push('score_buckets');
            if (selectedItems.config) collectionsToTransfer.push('config');

            if (collectionsToTransfer.length === 0 && !selectedItems.users) {
                alert('Please select at least one item to transfer.');
                return;
            }

            const msg = `${operation.toUpperCase()} selected data from "${sourceVariantId}" (DB ${selectedSchool.dbIndex}) to "${targetVariantId}" (DB ${targetDbIndex})?\n\nTarget data will be OVERWRITTEN.`;
            if (!confirm(msg)) return;

            showLoadingOverlay(`Starting Granular ${operation}...`, true);
            const sourceDb = dbs[selectedSchool.dbIndex];
            const targetDb = dbs[targetDbIndex];

            try {
                // 1. Handle Users Field
                if (selectedItems.users) {
                    showLoadingOverlay(`Transferring Users field...`, true);
                    const sourceDoc = await getDoc(doc(sourceDb, 'schools', sourceVariantId));
                    if (sourceDoc.exists()) {
                        const userData = sourceDoc.data().users;
                        if (userData) {
                            await setDoc(doc(targetDb, 'schools', targetVariantId), { users: userData }, { merge: true });
                            if (operation === 'move') {
                                await updateDoc(doc(sourceDb, 'schools', sourceVariantId), { users: deleteField() });
                            }
                        }
                    }
                }

                // 2. Handle Collections
                for (const item of collectionsToTransfer) {
                    showLoadingOverlay(`Transferring collection: ${item}...`, true);
                    const snapshot = await getDocs(collection(sourceDb, 'schools', sourceVariantId, item));
                    if (!snapshot.empty) {
                        for (const d of snapshot.docs) {
                            await setDoc(doc(targetDb, 'schools', targetVariantId, item, d.id), d.data());
                            if (operation === 'move') {
                                await deleteDoc(doc(sourceDb, 'schools', sourceVariantId, item, d.id));
                            }
                        }
                    }
                }

                // 3. SPECIAL HANDLING: Student Bucket (Optimization)
                if (selectedItems.students) {
                    showLoadingOverlay(`Checking Student Bucket...`, true);
                    const manifestRef = doc(sourceDb, "schools", sourceVariantId, "config", "student_bucket_manifest");
                    const manifestSnap = await getDoc(manifestRef);

                    if (manifestSnap.exists()) {
                        // Copy existing manifest and chunks
                        const manifestData = manifestSnap.data();
                        await setDoc(doc(targetDb, "schools", targetVariantId, "config", "student_bucket_manifest"), manifestData);

                        for (let i = 0; i < manifestData.totalChunks; i++) {
                            const chunkId = `student_bucket_${i}`;
                            const chunkSnap = await getDoc(doc(sourceDb, "schools", sourceVariantId, "config", chunkId));
                            if (chunkSnap.exists()) {
                                await setDoc(doc(targetDb, "schools", targetVariantId, "config", chunkId), chunkSnap.data());
                                if (operation === 'move') await deleteDoc(doc(sourceDb, "schools", sourceVariantId, "config", chunkId));
                            }
                        }
                        if (operation === 'move') await deleteDoc(manifestRef);
                    } else {
                        // Rebuild from students collection (which we just copied)
                        showLoadingOverlay(`Rebuilding Student Bucket...`, true);
                        const studentsSnap = await getDocs(collection(targetDb, 'schools', targetVariantId, 'students'));
                        const students = studentsSnap.docs.map(d => d.data());
                        if (students.length > 0) {
                            await rebuildStudentBucket(targetDb, targetVariantId, students);
                        }
                    }
                }

                // 4. SPECIAL HANDLING: Metadata Bundle (Optimization)
                if (selectedItems.assessments || selectedItems.classes || selectedItems.subjects) {
                    showLoadingOverlay(`Checking Metadata Bundle...`, true);
                    const bundleRef = doc(sourceDb, "schools", sourceVariantId, "config", "metadata_bundle");
                    const bundleSnap = await getDoc(bundleRef);

                    if (bundleSnap.exists()) {
                        await setDoc(doc(targetDb, "schools", targetVariantId, "config", "metadata_bundle"), bundleSnap.data(), { merge: true });
                        if (operation === 'move') await deleteDoc(bundleRef);
                    } else {
                        // Rebuild from target collections
                        showLoadingOverlay(`Rebuilding Metadata Bundle...`, true);
                        const bundleData = {};
                        if (selectedItems.assessments) {
                            const snap = await getDocs(collection(targetDb, 'schools', targetVariantId, 'assessments'));
                            bundleData.assessments = snap.docs.map(d => d.data());
                        }
                        if (selectedItems.classes) {
                            const snap = await getDocs(collection(targetDb, 'schools', targetVariantId, 'classes'));
                            bundleData.classes = snap.docs.map(d => d.data());
                        }
                        if (selectedItems.subjects) {
                            const snap = await getDocs(collection(targetDb, 'schools', targetVariantId, 'subjects'));
                            bundleData.subjects = snap.docs.map(d => d.data());
                        }
                        await rebuildMetadataBundle(targetDb, targetVariantId, bundleData);
                    }
                }

                alert(`✅ Granular ${operation} complete!`);
                if (operation === 'move') await fetchAllSchools();
            } catch (e) {
                console.error('Granular transfer failed:', e);
                alert(`❌ Transfer failed: ${e.message}`);
            } finally {
                showLoadingOverlay('', false);
            }
        }


        window.activateLicense = async function () {
            if (!selectedSchool || !(await verifyMasterPassword())) return;
            const s = parseInt(document.getElementById('maxStudents').value);
            const c = parseInt(document.getElementById('maxClass').value);
            const val = parseInt(document.getElementById('durationValue').value);
            const unit = document.getElementById('durationUnit').value;

            if (!s || !c || !val) {
                await showConfirm({ title: 'Missing Info', message: 'Please fill all fields before activating.', hideCancel: true, variant: 'danger' });
                return;
            }

            let addTime = false;
            const now = new Date();
            if (selectedSchool.existingExpiry && selectedSchool.existingExpiry > now) {
                addTime = await showConfirm({
                    title: 'Active Subscription Found',
                    message: `This school has an active subscription until ${selectedSchool.existingExpiry.toLocaleDateString()}. Would you like to ADD the new duration to the existing time?`,
                    confirmText: 'Accumulate Time',
                    cancelText: 'Start Fresh',
                    variant: 'info'
                });
            }

            if (!await showConfirm({
                title: 'Confirm Manual License',
                message: `Activate manual license for ${selectedSchool.name} (All Variations)?\nMode: ${addTime ? 'ACCUMULATE' : 'RESTART'}`,
                variant: 'warning'
            })) return;

            showLoadingOverlay('Activating...', true);
            try {
                // Calculate Expiry Date
                const baseDate = (addTime && selectedSchool.existingExpiry) ? selectedSchool.existingExpiry : new Date();
                const expiryDate = new Date(baseDate.getTime());

                if (unit === 'days') expiryDate.setDate(baseDate.getDate() + val);
                else if (unit === 'weeks') expiryDate.setDate(baseDate.getDate() + (val * 7));
                else if (unit === 'months') expiryDate.setMonth(baseDate.getMonth() + val);
                else if (unit === 'years') expiryDate.setFullYear(baseDate.getFullYear() + val);

                const sub = {
                    maxStudents: s,
                    maxClass: c,
                    expiryDate: Timestamp.fromDate(expiryDate),
                    activationHash: SYSTEM_ACTIVATION_HASH,
                    lastActivated: Timestamp.now()
                };

                // Write Subscription
                console.log(`[Firestore] Writing Manual Subscription for ${selectedSchool.baseName}:`, sub);
                await setDoc(doc(dbs[selectedSchool.dbIndex], 'subscriptions', selectedSchool.baseName), sub);

                // BATCH UPDATE ACCESS FOR ALL VARIANTS
                const variants = schools.filter(s => s.baseName === selectedSchool.baseName);
                const updates = variants.map(variant => {
                    const schoolRef = doc(dbs[variant.dbIndex], 'schools', variant.id);
                    const payload = {
                        Access: true,
                        activationHash: SYSTEM_ACTIVATION_HASH
                    };
                    console.log(`[Firestore] Updating School ${variant.id} (Manual Unlock):`, payload);
                    return setDoc(schoolRef, payload, { merge: true });
                });

                await Promise.all(updates);
                console.log(`[Batch Update] Granted access to ${variants.length} content variants for ${selectedSchool.baseName}`);

                await showConfirm({
                    title: 'Activation Successful',
                    message: `Manual template activated & Access Granted for ${variants.length} variants!`,
                    confirmText: 'Great!',
                    hideCancel: true,
                    variant: 'success'
                });

                // Update local model
                variants.forEach(v => v.access = true);
                renderSchools(document.getElementById('searchInput').value);

                resetPortal();
            } catch (e) {
                console.error(e);
                alert('CRITICAL: Activation failed.');
            } finally {
                showLoadingOverlay('', false);
            }
        }

        function resetPortal() {
            const pwd = document.getElementById('activationPassword');
            if (pwd) pwd.value = '';
            selectedSchool = null;
            selectedTemplate = null;
            updateUI();
        }

        window.showConfirm = function (config) {
            return new Promise((resolve) => {
                const modal = document.getElementById('customModal');
                const titleEl = document.getElementById('modalTitle');
                const messageEl = document.getElementById('modalMessage');
                const confirmBtn = document.getElementById('modalConfirmBtn');
                const cancelBtn = document.getElementById('modalCancelBtn');
                const iconContainer = document.getElementById('modalIcon');
                const iconPath = document.getElementById('modalIconPath');

                titleEl.textContent = config.title || 'Confirm';
                messageEl.textContent = config.message || '';
                confirmBtn.textContent = config.confirmText || 'Confirm';
                cancelBtn.textContent = config.cancelText || 'Cancel';
                cancelBtn.classList.toggle('hidden', config.hideCancel);

                // Styling based on variant
                const variant = config.variant || 'info';
                if (variant === 'danger') {
                    iconContainer.className = 'w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner';
                    confirmBtn.className = 'flex-1 py-4 bg-red-600 text-white font-black rounded-2xl hover:bg-red-700 transition-all shadow-lg hover:shadow-red-500/30';
                    iconPath.setAttribute('d', 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z');
                } else if (variant === 'success') {
                    iconContainer.className = 'w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner';
                    confirmBtn.className = 'flex-1 py-4 bg-green-600 text-white font-black rounded-2xl hover:bg-green-700 transition-all shadow-lg hover:shadow-green-500/30';
                    iconPath.setAttribute('d', 'M5 13l4 4L19 7');
                } else if (variant === 'warning') {
                    iconContainer.className = 'w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner';
                    confirmBtn.className = 'flex-1 py-4 bg-amber-600 text-white font-black rounded-2xl hover:bg-amber-700 transition-all shadow-lg hover:shadow-amber-500/30';
                    iconPath.setAttribute('d', 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z');
                } else {
                    iconContainer.className = 'w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner';
                    confirmBtn.className = 'flex-1 py-4 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 transition-all shadow-lg hover:shadow-blue-500/30';
                    iconPath.setAttribute('d', 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z');
                }

                const onConfirm = () => {
                    modal.classList.add('hidden');
                    confirmBtn.removeEventListener('click', onConfirm);
                    cancelBtn.removeEventListener('click', onCancel);
                    resolve(true);
                };

                const onCancel = () => {
                    modal.classList.add('hidden');
                    confirmBtn.removeEventListener('click', onConfirm);
                    cancelBtn.removeEventListener('click', onCancel);
                    resolve(false);
                };

                confirmBtn.addEventListener('click', onConfirm);
                cancelBtn.addEventListener('click', onCancel);
                modal.classList.remove('hidden');
            });
        };

        window.showLoadingOverlay = function (text, s) {
            const el = document.getElementById('loadingText');
            if (el) el.textContent = text || 'Writing to Cloud...';
            document.getElementById('loadingOverlay').classList.toggle('hidden', !s);
        }

        window.addEventListener('DOMContentLoaded', () => {
            loadBootstrapData();
            document.getElementById('searchInput').addEventListener('input', (e) => {
                currentPage = 1;
                renderSchools(e.target.value);
            });
            document.getElementById('durationValue').addEventListener('input', updateExpectedExpiry);
            document.getElementById('durationUnit').addEventListener('change', updateExpectedExpiry);
            document.getElementById('refreshBtn').addEventListener('click', fetchAllSchools);

            document.body.addEventListener('click', async (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;

                const clickedButton = target.closest('#viewSummaryBtn, #deleteDatabaseBtn');
                if (!clickedButton) return;

                event.preventDefault();
                if (clickedButton.id === 'viewSummaryBtn' && typeof window.viewDatabaseSummary === 'function') {
                    await window.viewDatabaseSummary();
                }
                if (clickedButton.id === 'deleteDatabaseBtn' && typeof window.deleteDatabase === 'function') {
                    await window.deleteDatabase();
                }
            });
        });
    