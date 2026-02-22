let data = {};
    let currentCalendarDate = new Date();

    async function refresh() {
      const res = await fetch('/api/data');
      data = await res.json();
      render();
    }

    function render() {
      document.getElementById('userCount').textContent = data.users.length;
      document.getElementById('groupCount').textContent = data.groups.length;

      const users = document.getElementById('users');
      users.textContent = '';
      data.users.forEach(u => {
        const div = document.createElement('div');
        div.className = 'item';
        // If name equals email, just show email; otherwise show "name (email)"
        div.textContent = u.name === u.email ? u.email : u.name + ' (' + u.email + ')';
        users.appendChild(div);
      });

      const groups = document.getElementById('groups');
      groups.textContent = '';
      data.groups.forEach(g => {
        const div = document.createElement('div');
        div.className = 'item';
        const title = document.createElement('div');
        title.textContent = g.name;
        title.style.fontWeight = 'bold';
        div.appendChild(title);

        const membersList = document.createElement('div');
        membersList.style.marginTop = '8px';
        g.members.forEach(m => {
          const user = data.users.find(u => u.id === m.userId);
          const memberDiv = document.createElement('div');
          memberDiv.style.display = 'flex';
          memberDiv.style.justifyContent = 'space-between';
          memberDiv.style.alignItems = 'center';
          memberDiv.style.padding = '4px 0';
          memberDiv.style.fontSize = '13px';

          const nameSpan = document.createElement('span');
          // If name equals email, show username part only; otherwise show full name
          const displayName = user?.name === user?.email
            ? (user.email.split('@')[0])
            : (user?.name || 'Unknown');
          nameSpan.textContent = displayName;
          memberDiv.appendChild(nameSpan);

          const removeBtn = document.createElement('button');
          removeBtn.textContent = 'Remove';
          removeBtn.style.fontSize = '11px';
          removeBtn.style.padding = '2px 6px';
          removeBtn.style.background = '#ea4335';
          removeBtn.style.color = 'white';
          removeBtn.style.border = 'none';
          removeBtn.style.borderRadius = '3px';
          removeBtn.style.cursor = 'pointer';
          removeBtn.onclick = () => removeMember(g.id, m.userId);
          memberDiv.appendChild(removeBtn);

          membersList.appendChild(memberDiv);
        });
        div.appendChild(membersList);

        const btnContainer = document.createElement('div');
        btnContainer.style.marginTop = '10px';

        const addBtn = document.createElement('button');
        addBtn.className = 'btn';
        addBtn.textContent = 'Add Member';
        addBtn.style.fontSize = '12px';
        addBtn.style.padding = '6px 12px';
        addBtn.onclick = () => addMember(g.id);
        btnContainer.appendChild(addBtn);

        const triggerBtn = document.createElement('button');
        triggerBtn.className = 'btn btn-success';
        triggerBtn.textContent = 'Trigger 1 Week';
        triggerBtn.style.fontSize = '12px';
        triggerBtn.style.padding = '6px 12px';
        triggerBtn.onclick = () => trigger(g.id, 1);
        btnContainer.appendChild(triggerBtn);

        const week4Btn = document.createElement('button');
        week4Btn.className = 'btn btn-success';
        week4Btn.textContent = '4 Weeks';
        week4Btn.style.fontSize = '12px';
        week4Btn.style.padding = '6px 12px';
        week4Btn.onclick = () => trigger(g.id, 4);
        btnContainer.appendChild(week4Btn);

        const week8Btn = document.createElement('button');
        week8Btn.className = 'btn btn-success';
        week8Btn.textContent = '8 Weeks';
        week8Btn.style.fontSize = '12px';
        week8Btn.style.padding = '6px 12px';
        week8Btn.onclick = () => trigger(g.id, 8);
        btnContainer.appendChild(week8Btn);

        const week12Btn = document.createElement('button');
        week12Btn.className = 'btn btn-success';
        week12Btn.textContent = '12 Weeks';
        week12Btn.style.fontSize = '12px';
        week12Btn.style.padding = '6px 12px';
        week12Btn.onclick = () => trigger(g.id, 12);
        btnContainer.appendChild(week12Btn);

        const customBtn = document.createElement('button');
        customBtn.className = 'btn btn-success';
        customBtn.textContent = 'Custom...';
        customBtn.style.fontSize = '12px';
        customBtn.style.padding = '6px 12px';
        customBtn.onclick = () => triggerCustom(g.id);
        btnContainer.appendChild(customBtn);

        div.appendChild(btnContainer);
        groups.appendChild(div);
      });

      renderCalendar();

      const rotations = document.getElementById('rotations');
      rotations.textContent = '';
      data.rotations.slice(-10).reverse().forEach(r => {
        const div = document.createElement('div');
        div.style.padding = '10px';
        div.style.background = '#f0f0f0';
        div.style.margin = '5px 0';
        div.style.borderRadius = '4px';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';

        const user = data.users.find(u => u.id === r.assignedUserId);
        const group = data.groups.find(g => g.id === r.groupId);

        const text = document.createElement('span');
        text.textContent = (group?.name || 'Unknown') + ' → ' + (user?.name || 'Unknown') + ' (' + r.weekStartDate + ')';
        div.appendChild(text);

        const isFuture = new Date(r.weekStartDate) >= new Date();
        if (isFuture) {
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'btn';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.style.fontSize = '11px';
          cancelBtn.style.padding = '4px 8px';
          cancelBtn.style.background = '#ea4335';
          cancelBtn.onclick = () => cancelRotation(r.id);
          div.appendChild(cancelBtn);
        }

        rotations.appendChild(div);
      });
    }

    async function addMember(groupId) {
      if (data.users.length === 0) {
        alert('No users available. Click "Connect Google" to add yourself first. make sure you are on the test list.');
        return;
      }

      const group = data.groups.find(g => g.id === groupId);
      const availableUsers = data.users.filter(u =>
        !group.members.some(m => m.userId === u.id)
      );

      if (availableUsers.length === 0) {
        alert('All users are already in this group.');
        return;
      }

      let userList = 'Select a user to add:\n\n';
      availableUsers.forEach((u, i) => {
        userList += (i + 1) + '. ' + u.name + ' (' + u.email + ')\n';
      });

      const selection = prompt(userList + '\nEnter number (1-' + availableUsers.length + '):');
      if (!selection) return;

      const index = parseInt(selection) - 1;
      if (index < 0 || index >= availableUsers.length) {
        alert('Invalid selection');
        return;
      }

      const selectedUser = availableUsers[index];

      const res = await fetch('/api/groups/' + groupId + '/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id })
      });

      const result = await res.json();
      if (result.success) {
        alert('Added ' + selectedUser.name + ' to group!');
        refresh();
      } else {
        alert('Error: ' + result.error);
      }
    }

    async function trigger(groupId, numWeeks) {
      const confirmMsg = numWeeks === 1
        ? 'Trigger rotation for 1 week?'
        : `Schedule ${numWeeks} weeks of rotations?`;
      if (!confirm(confirmMsg)) return;

      const res = await fetch('/api/trigger/' + groupId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numWeeks })
      });
      const result = await res.json();
      alert(result.message || result.error);
      refresh();
    }

    async function triggerCustom(groupId) {
      const input = prompt('How many weeks to schedule?\n\nExamples:\n- Enter "52" for 1 year\n- Enter "104" for 2 years\n- Enter "260" for 5 years');
      if (!input) return;

      const numWeeks = parseInt(input);
      if (isNaN(numWeeks) || numWeeks < 1 || numWeeks > 520) {
        alert('Please enter a valid number between 1 and 520 weeks (10 years)');
        return;
      }

      if (!confirm(`Schedule ${numWeeks} weeks of rotations?`)) return;

      const res = await fetch('/api/trigger/' + groupId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numWeeks })
      });
      const result = await res.json();
      alert(result.message || result.error);
      refresh();
    }

    async function cancelRotation(rotationId) {
      if (!confirm('Cancel this rotation? The calendar event will be deleted.')) return;

      const res = await fetch('/api/rotations/' + rotationId, {
        method: 'DELETE'
      });
      const result = await res.json();
      alert(result.message || result.error);
      refresh();
    }

    async function removeMember(groupId, userId) {
      const user = data.users.find(u => u.id === userId);
      if (!confirm('Remove ' + user.name + ' from this group? All future rotations will be cancelled.')) return;

      const res = await fetch('/api/groups/' + groupId + '/members/' + userId, {
        method: 'DELETE'
      });
      const result = await res.json();
      alert(result.message || result.error);
      refresh();
    }

    // Returns the actual visit date (YYYY-MM-DD) for a rotation based on the group's dayOfWeek.
    // weekStartDate is always Monday; dayOfWeek 1=Mon, 2=Tue, ..., 7=Sun.
    function getRotationDate(rotation) {
      const group = data.groups.find(g => g.id === rotation.groupId);
      if (!group) return null;
      const [y, m, d] = rotation.weekStartDate.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      date.setDate(date.getDate() + (group.schedule.dayOfWeek - 1));
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function renderCalendar() {
      const year = currentCalendarDate.getFullYear();
      const month = currentCalendarDate.getMonth();

      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
      document.getElementById('calendarMonth').textContent = monthNames[month] + ' ' + year;

      const firstDay = new Date(year, month, 1).getDay();
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      const calendar = document.getElementById('calendar');
      calendar.textContent = '';

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      dayNames.forEach(name => {
        const dayHeader = document.createElement('div');
        dayHeader.textContent = name;
        dayHeader.style.fontWeight = 'bold';
        dayHeader.style.textAlign = 'center';
        dayHeader.style.padding = '8px';
        dayHeader.style.background = '#667eea';
        dayHeader.style.color = 'white';
        dayHeader.style.borderRadius = '4px';
        calendar.appendChild(dayHeader);
      });

      for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.style.minHeight = '80px';
        calendar.appendChild(emptyCell);
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayRotations = data.rotations.filter(r => getRotationDate(r) === dateStr);

        const dayCell = document.createElement('div');
        dayCell.style.minHeight = '80px';
        dayCell.style.border = '1px solid #ddd';
        dayCell.style.borderRadius = '4px';
        dayCell.style.padding = '5px';
        dayCell.style.background = dayRotations.length > 0 ? '#e8f5e9' : 'white';
        dayCell.style.cursor = dayRotations.length > 0 ? 'pointer' : 'default';

        const dayNum = document.createElement('div');
        dayNum.textContent = day;
        dayNum.style.fontWeight = 'bold';
        dayNum.style.marginBottom = '5px';
        dayCell.appendChild(dayNum);

        if (dayRotations.length > 0) {
          dayRotations.forEach(r => {
            const user = data.users.find(u => u.id === r.assignedUserId);
            const group = data.groups.find(g => g.id === r.groupId);
            const rotDiv = document.createElement('div');
            rotDiv.textContent = (user?.name || 'Unknown').split('@')[0];
            rotDiv.style.fontSize = '11px';
            rotDiv.style.background = '#4285f4';
            rotDiv.style.color = 'white';
            rotDiv.style.padding = '2px 4px';
            rotDiv.style.borderRadius = '3px';
            rotDiv.style.marginTop = '2px';
            rotDiv.style.overflow = 'hidden';
            rotDiv.style.textOverflow = 'ellipsis';
            rotDiv.style.whiteSpace = 'nowrap';
            rotDiv.title = `${group?.name || 'Unknown'}: ${user?.name || 'Unknown'}`;
            dayCell.appendChild(rotDiv);
          });
        }

        calendar.appendChild(dayCell);
      }
    }

    function changeMonth(delta) {
      currentCalendarDate.setMonth(currentCalendarDate.getMonth() + delta);
      renderCalendar();
    }

    refresh();