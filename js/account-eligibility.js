// Date-of-birth checks are mirrored by the database; browser checks avoid sending
// an under-13 registration in the normal flow. They are not identity verification.
window.APSUAccount = {
  ageOn(value, today = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

    const [year, month, day] = value.split('-').map(Number),
      date = new Date(year, month - 1, day);

    if (
      year < 1900 ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day ||
      date > today
    )
      return null;

    return (
      today.getFullYear() -
      year -
      (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)
        ? 1
        : 0)
    );
  },
  async require(client) {
    const { data, error } = await client.rpc('get_account_eligibility');

    if (error)
      throw new Error(
        error.code === 'PGRST202'
          ? 'Age confirmation needs the prepared database update.'
          : error.message,
      );
    if (!data?.confirmed) {
      location.replace('account-eligibility.html');
      return false;
    }

    return true;
  },
};
