export function groupSpeakers(people) {
  const groups = [];
  const normalize = (value) => (value || '').trim().toLocaleLowerCase();
  for (const person of people) {
    const matches = groups.filter((group) =>
      group.some(
        (other) =>
          person.id.split(':').at(-1) === other.id.split(':').at(-1) ||
          (normalize(person.name) === normalize(other.name) &&
            normalize(person.company) &&
            normalize(person.company) === normalize(other.company)),
      ),
    );
    if (!matches.length) groups.push([person]);
    else {
      matches[0].push(person);
      for (const group of matches.slice(1)) {
        matches[0].push(...group);
        groups.splice(groups.indexOf(group), 1);
      }
    }
  }
  return groups;
}
