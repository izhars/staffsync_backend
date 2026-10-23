const getUpcomingCelebrations = async (dateField, days, additionalFilters = {}, limit = 10, skip = 0) => {
  console.time(`getUpcomingCelebrations-${dateField}`);
  const today = moment();
  const endDate = moment().add(days, 'days');
  
  const result = await timeout(
    User.aggregate([
      {
        $match: {
          [dateField]: { $exists: true, $ne: null },
          isActive: true,
          role: 'employee',
          ...additionalFilters
        }
      },
      {
        $project: {
          employeeId: 1,
          firstName: 1,
          lastName: 1,
          email: 1,
          department: 1,
          fullName: 1,
          dateField: `$${dateField}`,
          dayOfYear: {
            $dayOfYear: {
              $dateFromParts: {
                year: today.year(),
                month: { $month: `$${dateField}` },
                day: { $dayOfMonth: `$${dateField}` }
              }
            }
          }
        }
      },
      {
        $match: {
          dayOfYear: {
            $gt: today.dayOfYear(), // Changed from $gte to $gt to exclude today
            $lte: endDate.dayOfYear()
          }
        }
      },
      { $sort: { dayOfYear: 1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'departments',
          localField: 'department',
          foreignField: '_id',
          as: 'department',
          pipeline: [{ $project: { name: 1 } }]
        }
      },
      { $unwind: { path: '$department', preserveNullAndEmptyArrays: true } },
      { $project: { department: '$department.name', employeeId: 1, firstName: 1, lastName: 1, email: 1, fullName: 1, dateField: 1 } }
    ]),
    5000 // 5-second timeout
  );
  
  console.timeEnd(`getUpcomingCelebrations-${dateField}`);
  return result;
};